import type { PaymentResult } from "./pay";
import type { Contractor, Decision } from "./types";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One row per invoice: what was decided, under which policy version, and — for
 * paid invoices — the onchain transfer that settled it. This is the file an
 * accountant needs at month end to reconcile the crypto leg.
 */
export function receiptsCsv(decisions: Decision[], payments: PaymentResult[], contractors: Contractor[]): string {
  const header = [
    "invoice_id", "invoice_number", "contractor", "period_start", "period_end", "amount_usdc",
    "verdict", "policy_version", "policy_hash", "cited_clauses", "reason", "payment_status", "settled_usdc", "tx_hash", "explorer_url", "paid_to", "serv_request_ids",
  ];
  const rows = decisions.map((d) => {
    const c = contractors.find((x) => x.id === d.contractorId);
    const p = payments.filter((x) => x.invoiceId === d.invoiceId).at(-1);
    const reason = d.blockedByGuard
      ? "Blocked by SERV Prompt Guard: injection attempt in invoice"
      : [...(d.judgment?.reasons.map((r) => `§${r.clause}: ${r.finding}`) ?? []), ...d.overriddenBy.map((o) => `invariant ${o}`)].join(" | ");
    return [
      d.invoiceId, d.fields?.invoiceNumber, c?.name ?? d.fields?.contractorName, d.fields?.periodStart, d.fields?.periodEnd,
      d.fields?.totalUsdc, d.finalVerdict, d.policyVersion, d.policyHash.slice(0, 12), d.judgment?.citedClauses.join(" "),
      reason, p?.status ?? "", p?.settledUsdc ?? "", p?.txHash ?? "", p?.txHash ? `https://sepolia.basescan.org/tx/${p.txHash}` : "", p?.to ?? "",
      d.calls.flatMap((x) => (x.requestId ? [x.requestId] : [])).join(" "),
    ].map(esc).join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}

import { readAgreement } from "./agreement";
import { decide, MODES } from "./decide";
import { makePolicyVersion } from "./policy";
import type { ServClient } from "./serv";
import type { Contractor } from "./types";

/**
 * Payrun Check: the invoice review as a service another agent can buy.
 * The caller brings its own policy, the invoice and the payee's terms; SERV
 * reads the terms, Prompt Guard screens the invoice, code checks the facts and
 * SERV applies the policy (Kronos + Multipath, Shadow Agent). Nothing is paid.
 */
export interface CheckInput {
  policy: string;
  invoice: string;
  /** The agreement or email that sets rate, cap and wallet. Optional, but without it nothing can be checked against terms. */
  terms?: string;
}

export interface CheckResult {
  verdict: "PAY" | "HOLD" | "BLOCK";
  blockedByGuard: boolean;
  clauses: { number: number; text: string }[];
  reasons: { clause: number; finding: string; evidence: string }[];
  codeFindings: { code: string; detail: string; hard: boolean }[];
  policyCovers: boolean | null;
  suspectedManipulation: boolean | null;
  termsRead: Partial<Contractor> | null;
  termsMissing: string[];
  servRequests: number;
  /** x-openserv-request-id of every SERV call behind this verdict, for the caller's audit trail. */
  servRequestIds: string[];
}

export async function checkInvoice(serv: ServClient, input: CheckInput): Promise<CheckResult> {
  if (!input.policy?.trim() || !input.invoice?.trim()) throw new Error("Send both a policy and an invoice.");
  const policy = makePolicyVersion(input.policy.slice(0, 8000), 1);

  let contractors: Contractor[] = [];
  let termsRead: Partial<Contractor> | null = null;
  let termsMissing: string[] = ["terms"];
  let requests = 0;
  const ids: string[] = [];
  if (input.terms?.trim()) {
    const draft = await readAgreement(serv, input.terms);
    requests++;
    if (draft.meta?.requestId) ids.push(draft.meta.requestId);
    termsRead = draft.contractor;
    termsMissing = draft.missing;
    const c = draft.contractor;
    if (c.name && c.wallet && c.dayRateUsdc && c.monthlyDayCap) {
      contractors = [{ id: "payee", name: c.name, email: c.email ?? "", wallet: c.wallet, network: "base-sepolia", dayRateUsdc: c.dayRateUsdc, monthlyDayCap: c.monthlyDayCap, scope: c.scope ?? "", expenseApprovals: [] } as Contractor];
    }
  }

  const d = await decide(serv, {
    invoice: { id: `check-${Date.now()}`, source: "x402", rawText: input.invoice.slice(0, 20000), receivedAt: new Date().toISOString() },
    policy,
    contractors,
    history: [],
    mode: MODES.serv,
  });
  requests += d.calls.length;
  ids.push(...d.calls.flatMap((c) => (c.requestId ? [c.requestId] : [])));
  const cited = d.judgment?.citedClauses ?? [];
  return {
    verdict: d.finalVerdict,
    blockedByGuard: d.blockedByGuard,
    clauses: cited.map((n) => ({ number: n, text: policy.clauses[n - 1] })),
    reasons: (d.judgment?.reasons ?? []).map((r) => ({ clause: r.clause, finding: r.finding, evidence: r.evidenceQuote })),
    codeFindings: d.findings.map((f) => ({ code: f.code, detail: f.detail, hard: f.hard })),
    policyCovers: d.judgment?.policyCovers ?? null,
    suspectedManipulation: d.judgment?.suspectedManipulation ?? null,
    termsRead,
    termsMissing,
    servRequests: requests,
    servRequestIds: ids,
  };
}

import type { Contractor, Finding, InvoiceFields, Verdict } from "./types";

/** A previously decided invoice, used for duplicate and same-period checks. */
export interface HistoryEntry {
  invoiceId: string;
  contractorId: string;
  invoiceNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalUsdc: number | null;
  verdict: Verdict;
}

const cents = (n: number) => Math.round(n * 100);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const normInvoiceNo = (s: string | null) => norm(s).replace(/[^a-z0-9]/g, "").replace(/^(inv|invoice)/, "").replace(/^0+/, "");

export function matchContractor(fields: InvoiceFields, book: Contractor[]): Contractor | null {
  const email = norm(fields.contractorEmail);
  if (email) {
    const byEmail = book.find((c) => norm(c.email) === email);
    if (byEmail) return byEmail;
  }
  const name = norm(fields.contractorName);
  if (name) return book.find((c) => norm(c.name) === name) ?? null;
  return null;
}

function overlaps(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Deterministic checks. These compute facts the model must not be trusted to
 * compute (arithmetic, lookups, exact matches). Hard findings are invariants:
 * `applyInvariants` refuses PAY whenever one is present, whatever the model says,
 * and the same invariants are compiled into the wallet's onchain policy.
 */
export function runChecks(fields: InvoiceFields, contractor: Contractor | null, history: HistoryEntry[]): Finding[] {
  const out: Finding[] = [];
  if (!contractor) {
    out.push({ code: "UNKNOWN_CONTRACTOR", hard: true, detail: `No contractor on file matches "${fields.contractorName ?? "?"}" <${fields.contractorEmail ?? "?"}>.` });
    return out;
  }

  if (fields.payToWallet && norm(fields.payToWallet) !== norm(contractor.wallet)) {
    out.push({
      code: "WALLET_MISMATCH",
      hard: true,
      detail: `Invoice asks for payment to ${fields.payToWallet}; wallet on file is ${contractor.wallet}.`,
    });
  }
  if (fields.paymentChangeRequest) {
    out.push({ code: "WALLET_CHANGE_REQUEST", hard: false, detail: `Invoice contains a payment-details change request: "${fields.paymentChangeRequest}"` });
  }

  if (fields.totalUsdc == null) {
    out.push({ code: "MISSING_TOTAL", hard: true, detail: "Invoice has no total." });
  } else {
    const badLine = fields.lines.find((l) => cents(l.quantity * l.unitPriceUsdc) !== cents(l.amountUsdc));
    const lineSum = fields.lines.reduce((s, l) => s + cents(l.amountUsdc), 0);
    if (badLine) {
      out.push({ code: "ARITHMETIC_MISMATCH", hard: true, detail: `Line "${badLine.description}": ${badLine.quantity} × ${badLine.unitPriceUsdc} ≠ ${badLine.amountUsdc}.` });
    } else if (fields.lines.length && lineSum !== cents(fields.totalUsdc)) {
      out.push({ code: "ARITHMETIC_MISMATCH", hard: true, detail: `Lines sum to ${(lineSum / 100).toFixed(2)} but total is ${fields.totalUsdc.toFixed(2)}.` });
    }
  }

  const dayLines = fields.lines.filter((l) => l.unit === "day");
  const days = dayLines.reduce((s, l) => s + l.quantity, 0);
  if (days > contractor.monthlyDayCap) {
    out.push({ code: "OVER_DAY_CAP", hard: true, detail: `Bills ${days} days; agreement caps at ${contractor.monthlyDayCap} days per month.` });
  }
  const overRate = dayLines.find((l) => cents(l.unitPriceUsdc) > cents(contractor.dayRateUsdc));
  if (overRate) {
    out.push({ code: "RATE_MISMATCH", hard: true, detail: `Day rate billed ${overRate.unitPriceUsdc}; agreed rate is ${contractor.dayRateUsdc}.` });
  }

  // Anything already approved or waiting on a human counts: a reissue of a held invoice is still the same work.
  const mine = history.filter((h) => h.contractorId === contractor.id && h.verdict !== "BLOCK");
  const no = normInvoiceNo(fields.invoiceNumber);
  const dup = no ? mine.find((h) => normInvoiceNo(h.invoiceNumber) === no) : undefined;
  if (dup) {
    out.push({ code: "EXACT_DUPLICATE", hard: true, detail: `Invoice number ${fields.invoiceNumber} is already on file (${dup.invoiceId}, ${dup.verdict}).` });
  } else {
    const same = mine.find((h) => overlaps(fields.periodStart, fields.periodEnd, h.periodStart, h.periodEnd));
    if (same) {
      out.push({
        code: "SAME_PERIOD_ALREADY_BILLED",
        hard: false,
        detail: `Period ${fields.periodStart}–${fields.periodEnd} overlaps invoice ${same.invoiceNumber ?? same.invoiceId} already on file (${same.verdict}; ${same.periodStart}–${same.periodEnd}, ${same.totalUsdc} USDC).`,
      });
    }
  }
  return out;
}

/**
 * What the code checks confirmed, stated positively. Listing only problems left
 * small models unsure whether a clean invoice had been checked at all (a clean
 * invoice was held for "FACTS do not state whether the monthly cap is met").
 */
export function confirmedFacts(fields: InvoiceFields, contractor: Contractor | null, findings: Finding[]): string[] {
  if (!contractor) return [];
  const has = (code: Finding["code"]) => findings.some((f) => f.code === code);
  const out: string[] = [];
  const days = fields.lines.filter((l) => l.unit === "day").reduce((s, l) => s + l.quantity, 0);
  if (!has("OVER_DAY_CAP")) out.push(`Days billed: ${days}, within the ${contractor.monthlyDayCap}-day monthly cap.`);
  if (!has("RATE_MISMATCH") && days > 0) out.push(`Day rate billed does not exceed the agreed ${contractor.dayRateUsdc} USDC.`);
  if (!has("ARITHMETIC_MISMATCH") && !has("MISSING_TOTAL")) out.push("Line amounts and total add up.");
  if (!has("WALLET_MISMATCH")) out.push(fields.payToWallet ? "Wallet on the invoice matches the wallet on file." : "Invoice names no wallet; payment goes to the wallet on file.");
  if (!has("EXACT_DUPLICATE") && !has("SAME_PERIOD_ALREADY_BILLED")) out.push("No other invoice on file covers this invoice number or period.");
  const expenses = fields.lines.filter((l) => l.unit === "item" || l.unit === "expense");
  out.push(expenses.length ? `Non-day line items (expenses or fees): ${expenses.map((l) => `${l.description} ${l.amountUsdc} USDC`).join("; ")}.` : "No expense or fee lines.");
  return out;
}

const SEVERITY: Record<Verdict, number> = { PAY: 0, HOLD: 1, BLOCK: 2 };

/** Code has the last word: hard findings can only make a verdict stricter. */
export function applyInvariants(modelVerdict: Verdict, findings: Finding[]): { verdict: Verdict; overriddenBy: Finding["code"][] } {
  let verdict = modelVerdict;
  const overriddenBy: Finding["code"][] = [];
  for (const f of findings) {
    if (!f.hard) continue;
    const floor: Verdict = f.code === "EXACT_DUPLICATE" ? "BLOCK" : "HOLD";
    if (SEVERITY[floor] > SEVERITY[verdict]) {
      verdict = floor;
      overriddenBy.push(f.code);
    }
  }
  return { verdict, overriddenBy };
}

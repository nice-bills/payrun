import { isAddress } from "viem";
import { SMALL_MODEL } from "./decide";
import type { ServClient } from "./serv";
import type { CallMeta, Contractor, ExpenseApproval } from "./types";

/**
 * SERV reads a contractor agreement (or the email that confirms one) and fills
 * in the terms Payrun enforces. The owner confirms every field before it is
 * saved; nothing read here is trusted until then.
 */
export const AGREEMENT_SYSTEM = [
  "You read contractor agreements and onboarding emails for a small company that pays contractors in USDC.",
  "Extract only terms that are written down. Copy names, emails and wallet addresses exactly. Never guess a number; use null when a term is absent.",
  "day_rate_usdc: the agreed pay per day in USDC (convert only if the text states a USD day rate; hourly rates times 8 only if the text says an 8-hour day).",
  "monthly_day_cap: the most days per month that may be billed.",
  "scope: one sentence describing the work covered.",
  "expense_approvals: expenses the text approves in writing in advance, each with a maximum amount.",
  "notes: anything in the text that would change how invoices should be treated, in one sentence, or null.",
].join("\n");

export const AGREEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "email", "wallet", "day_rate_usdc", "monthly_day_cap", "scope", "expense_approvals", "notes"],
  properties: {
    name: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    wallet: { type: ["string", "null"] },
    day_rate_usdc: { type: ["number", "null"] },
    monthly_day_cap: { type: ["integer", "null"] },
    scope: { type: ["string", "null"] },
    expense_approvals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "max_usdc", "approved_on", "approved_by"],
        properties: {
          description: { type: "string" },
          max_usdc: { type: "number" },
          approved_on: { type: ["string", "null"] },
          approved_by: { type: ["string", "null"] },
        },
      },
    },
    notes: { type: ["string", "null"] },
  },
} as const;

export interface AgreementDraft {
  contractor: Partial<Contractor>;
  notes: string | null;
  missing: string[];
  meta?: CallMeta;
}

interface RawAgreement {
  name: string | null;
  email: string | null;
  wallet: string | null;
  day_rate_usdc: number | null;
  monthly_day_cap: number | null;
  scope: string | null;
  expense_approvals: { description: string; max_usdc: number; approved_on: string | null; approved_by: string | null }[];
  notes: string | null;
}

export async function readAgreement(serv: ServClient, text: string, model = SMALL_MODEL): Promise<AgreementDraft> {
  const r = await serv.call<RawAgreement>({
    model,
    system: AGREEMENT_SYSTEM,
    user: `<agreement>\n${text.slice(0, 12000)}\n</agreement>`,
    schema: { name: "contractor_agreement", schema: AGREEMENT_SCHEMA },
    maxCompletionTokens: 1200,
    label: "agreement",
  });
  const a = r.parsed;
  if (!a) throw new Error("SERV could not read that agreement.");
  const contractor: Partial<Contractor> = {
    name: a.name ?? undefined,
    email: a.email ?? undefined,
    wallet: a.wallet && isAddress(a.wallet) ? (a.wallet as `0x${string}`) : undefined,
    network: "base-sepolia",
    dayRateUsdc: a.day_rate_usdc ?? undefined,
    monthlyDayCap: a.monthly_day_cap ?? undefined,
    scope: a.scope ?? undefined,
    expenseApprovals: a.expense_approvals.map(
      (e): ExpenseApproval => ({ description: e.description, maxUsdc: e.max_usdc, approvedOn: e.approved_on ?? "", approvedBy: e.approved_by ?? "" }),
    ),
  };
  const missing = (["name", "email", "wallet", "dayRateUsdc", "monthlyDayCap", "scope"] as const).filter((k) => contractor[k] === undefined);
  return { contractor, notes: a.notes, missing, meta: r.meta };
}

export function slugId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") || "contractor";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
}

/** Validate a contractor before it can be paid. Returns the problems, empty when fine. */
export function contractorProblems(c: Partial<Contractor>): string[] {
  const out: string[] = [];
  if (!c.name?.trim()) out.push("Name is missing.");
  if (!c.email?.includes("@")) out.push("Email is missing or not an email.");
  if (!c.wallet || !isAddress(c.wallet)) out.push("Wallet must be a 0x address.");
  if (!(Number(c.dayRateUsdc) > 0)) out.push("Day rate must be above zero.");
  if (!(Number.isInteger(Number(c.monthlyDayCap)) && Number(c.monthlyDayCap) > 0)) out.push("Monthly day cap must be a whole number above zero.");
  if (!c.scope?.trim()) out.push("Scope of work is missing.");
  return out;
}

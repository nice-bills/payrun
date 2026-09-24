import { decide, MODES, SMALL_MODEL, type DecideMode } from "./decide";
import { extractFields } from "./extract";
import type { ServClient } from "./serv";
import type { HistoryEntry } from "./checks";
import type { CallMeta, Contractor, Decision, Invoice, PolicyVersion, Verdict } from "./types";

/**
 * Gap finding rests on one idea from OpenServ's own write-up of bounded reasoning:
 * if the same input gives two answers, a policy is missing. SERV writes invoices
 * aimed at the policy's edges; each is judged several times under the compiled
 * policy; any case that flips, cites nothing, or that the model says the policy
 * does not cover is a gap the finance lead has to close in writing.
 */

/** The demo's "today": invoices for August arrive in early September. */
export const DEMO_RECEIVED_AT = "2026-09-05T09:00:00.000Z";

export const PROBE_SYSTEM = [
  "You write test invoices that probe the edges of a contractor payment policy.",
  "Each probe must be a realistic invoice from one of the listed contractors, written as plain text the way a real contractor would send it.",
  "Aim every probe at a situation the policy's wording leaves open: two clauses that conflict, a threshold exactly at a boundary, a case no clause mentions, or wording a reviewer could read two ways.",
  "Do not write probes that are obviously fine or obviously fraudulent. Do not include wallet addresses unless the probe is about payment details.",
  "Include invoice number, contractor name and email, billing period, line items with quantity, unit, unit price and amount, and a total. Keep arithmetic correct unless arithmetic is the point.",
  "For each probe give the date the invoice is received, and, if the probe depends on an earlier invoice having been paid, that earlier invoice; otherwise null.",
  "For each probe give the two most plausible readings of the policy and the verdict (PAY, HOLD or BLOCK) each reading leads to.",
].join("\n");

export const PROBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["probes"],
  properties: {
    probes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "contractor_id", "invoice_text", "target_clauses", "why_ambiguous", "received_on", "prior_paid", "readings"],
        properties: {
          title: { type: "string" },
          contractor_id: { type: "string" },
          invoice_text: { type: "string" },
          target_clauses: { type: "array", items: { type: "integer" } },
          why_ambiguous: { type: "string" },
          received_on: { type: "string", description: "YYYY-MM-DD" },
          prior_paid: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["invoice_number", "period_start", "period_end", "total_usdc"],
            properties: {
              invoice_number: { type: "string" },
              period_start: { type: "string" },
              period_end: { type: "string" },
              total_usdc: { type: "number" },
            },
          },
          readings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["reading", "verdict"],
              properties: { reading: { type: "string" }, verdict: { type: "string", enum: ["PAY", "HOLD", "BLOCK"] } },
            },
          },
        },
      },
    },
  },
} as const;

export const SUGGEST_SYSTEM = [
  "You close gaps in a contractor payment policy.",
  "Given the policy and a case its wording leaves open, write exactly one new clause of at most 35 words that decides it the way the observed verdict did, so the company can confirm or reverse it explicitly.",
  "Write it in the same plain style as the existing clauses. Do not restate existing clauses.",
].join("\n");

export const SUGGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clause", "decides_as"],
  properties: {
    clause: { type: "string" },
    decides_as: { type: "string", enum: ["PAY", "HOLD", "BLOCK"] },
  },
} as const;

export interface Reading {
  reading: string;
  verdict: Verdict;
}

export interface Probe {
  title: string;
  contractorId: string;
  invoiceText: string;
  targetClauses: number[];
  whyAmbiguous: string;
  receivedOn: string;
  priorPaid: { invoiceNumber: string; periodStart: string; periodEnd: string; totalUsdc: number } | null;
  readings: Reading[];
}

/**
 * UNSTABLE      — the same invoice got different verdicts.
 * NOT_COVERED   — the model said no clause decides it.
 * NO_CLAUSE     — a verdict cited no clause.
 * SILENT_CHOICE — verdicts agree, but the policy can be read two ways that lead to
 *                 different verdicts: the reviewer picked a meaning nobody wrote down.
 *                 Bounded reasoning makes verdicts consistent, so this is the gap
 *                 that matters most under SERV.
 */
export type GapKind = "UNSTABLE" | "NOT_COVERED" | "NO_CLAUSE" | "SILENT_CHOICE";

export interface ProbeResult {
  probe: Probe;
  verdicts: Verdict[];
  /** Which stated reading the observed verdict matches, if exactly one does. */
  chosenReading: string | null;
  decisions: Decision[];
  gap: GapKind[];
  suggestion: { clause: string; decidesAs: Verdict } | null;
}

export interface GapReport {
  policyVersion: number;
  policyHash: string;
  results: ProbeResult[];
  gaps: ProbeResult[];
  calls: CallMeta[];
}

export function classifyGap(decisions: Decision[], readings: Reading[] = []): GapKind[] {
  const kinds: GapKind[] = [];
  const unstable = new Set(decisions.map((d) => d.finalVerdict)).size > 1;
  if (unstable) kinds.push("UNSTABLE");
  if (decisions.some((d) => d.judgment && !d.judgment.policyCovers)) kinds.push("NOT_COVERED");
  if (decisions.some((d) => d.judgment && d.judgment.citedClauses.length === 0)) kinds.push("NO_CLAUSE");
  // Only judgment calls count: a verdict forced by a code invariant is not the model choosing a meaning.
  const byJudgment = decisions.every((d) => d.judgment && d.overriddenBy.length === 0 && !d.blockedByGuard);
  if (!unstable && byJudgment && new Set(readings.map((r) => r.verdict)).size > 1) kinds.push("SILENT_CHOICE");
  return kinds;
}

function policyBlock(policy: PolicyVersion): string {
  return policy.clauses.map((c, i) => `${i + 1}. ${c}`).join("\n");
}

function contractorBlock(contractors: Contractor[]): string {
  return contractors
    .map((c) => `- id=${c.id} ${c.name} <${c.email}> day rate ${c.dayRateUsdc} USDC, cap ${c.monthlyDayCap} days/month, scope: ${c.scope}`)
    .join("\n");
}

export interface FindGapsOptions {
  probes?: number;
  runsPerProbe?: number;
  generatorModel?: string;
  mode?: DecideMode;
  /** Receipt date stamped on probes; fixed so runs are reproducible and replayable. */
  receivedAt?: string;
  onProgress?: (msg: string) => void;
}

export async function findGaps(
  serv: ServClient,
  policy: PolicyVersion,
  contractors: Contractor[],
  opts: FindGapsOptions = {},
): Promise<GapReport> {
  const n = opts.probes ?? 6;
  const runs = opts.runsPerProbe ?? 3;
  const mode = opts.mode ?? MODES.serv;
  const log = opts.onProgress ?? (() => {});
  const calls: CallMeta[] = [];

  log(`Writing ${n} boundary probes for policy v${policy.version}`);
  const gen = await serv.call<{
    probes: {
      title: string; contractor_id: string; invoice_text: string; target_clauses: number[]; why_ambiguous: string;
      received_on: string; prior_paid: { invoice_number: string; period_start: string; period_end: string; total_usdc: number } | null;
      readings: Reading[];
    }[];
  }>({
    model: opts.generatorModel ?? SMALL_MODEL,
    features: ["kronos"],
    system: PROBE_SYSTEM,
    user: `POLICY\n${policyBlock(policy)}\n\nCONTRACTORS\n${contractorBlock(contractors)}\n\nWrite ${n} probes.`,
    schema: { name: "policy_probes", schema: PROBE_SCHEMA },
    maxCompletionTokens: 4000,
    label: `probes-v${policy.version}`,
  });
  calls.push(gen.meta);
  const probes: Probe[] = (gen.parsed?.probes ?? []).slice(0, n).map((p) => ({
    title: p.title,
    contractorId: p.contractor_id,
    invoiceText: p.invoice_text,
    targetClauses: p.target_clauses,
    whyAmbiguous: p.why_ambiguous,
    receivedOn: p.received_on,
    priorPaid: p.prior_paid
      ? { invoiceNumber: p.prior_paid.invoice_number, periodStart: p.prior_paid.period_start, periodEnd: p.prior_paid.period_end, totalUsdc: p.prior_paid.total_usdc }
      : null,
    readings: p.readings,
  }));

  const results: ProbeResult[] = [];
  for (const [i, probe] of probes.entries()) {
    const receivedAt = /^\d{4}-\d{2}-\d{2}/.test(probe.receivedOn) ? `${probe.receivedOn.slice(0, 10)}T09:00:00.000Z` : opts.receivedAt ?? DEMO_RECEIVED_AT;
    const invoice: Invoice = { id: `probe-${i + 1}`, source: "gap-probe", rawText: probe.invoiceText, receivedAt };
    const contractorId = contractors.some((c) => c.id === probe.contractorId) ? probe.contractorId : "";
    const history: HistoryEntry[] = probe.priorPaid && contractorId
      ? [{ invoiceId: `probe-${i + 1}-prior`, contractorId, invoiceNumber: probe.priorPaid.invoiceNumber, periodStart: probe.priorPaid.periodStart, periodEnd: probe.priorPaid.periodEnd, totalUsdc: probe.priorPaid.totalUsdc, verdict: "PAY" }]
      : [];
    log(`Probe ${i + 1}/${probes.length}: ${probe.title}`);
    // Extract once, then judge repeatedly: we are measuring the policy, not extraction noise.
    const ex = await extractFields(serv, invoice.rawText, { model: mode.model, raw: mode.raw, guard: false }, `probe-extract-${i + 1}`);
    calls.push(ex.meta);
    if (!ex.fields) continue;
    const decisions: Decision[] = [];
    for (let r = 0; r < runs; r++) {
      const d = await decide(serv, { invoice, policy, contractors, history, mode: { ...mode, guard: false, shadow: false }, fields: ex.fields, variant: `run-${r + 1}` });
      decisions.push(d);
      calls.push(...d.calls);
    }
    const verdicts = decisions.map((d) => d.finalVerdict);
    const matching = probe.readings.filter((r) => r.verdict === verdicts[0]);
    results.push({
      probe,
      verdicts,
      chosenReading: new Set(verdicts).size === 1 && matching.length === 1 ? matching[0].reading : null,
      decisions,
      gap: classifyGap(decisions, probe.readings),
      suggestion: null,
    });
  }

  const gaps = results.filter((r) => r.gap.length > 0);
  for (const g of gaps) {
    log(`Drafting a clause for: ${g.probe.title}`);
    const s = await serv.call<{ clause: string; decides_as: Verdict }>({
      model: opts.generatorModel ?? SMALL_MODEL,
      system: SUGGEST_SYSTEM,
      user: [
        `POLICY\n${policyBlock(policy)}`,
        `CASE\n${g.probe.invoiceText}`,
        `WHY IT IS OPEN\n${g.probe.whyAmbiguous}`,
        `READINGS\n${g.probe.readings.map((r) => `- ${r.reading} → ${r.verdict}`).join("\n")}`,
        `OBSERVED VERDICTS ACROSS ${runs} RUNS: ${g.verdicts.join(", ")}`,
      ].join("\n\n"),
      schema: { name: "policy_clause", schema: SUGGEST_SCHEMA },
      maxCompletionTokens: 600,
      label: `suggest-v${policy.version}`,
    });
    calls.push(s.meta);
    if (s.parsed) g.suggestion = { clause: s.parsed.clause, decidesAs: s.parsed.decides_as };
  }

  return { policyVersion: policy.version, policyHash: policy.hash, results, gaps, calls };
}

/**
 * Write the clause that settles a gap the way the finance lead chose. One small
 * SERV call; the company, not the reviewer, decides what the policy means.
 */
export async function draftClause(
  serv: ServClient,
  policy: PolicyVersion,
  probe: Probe,
  chosen: Reading,
  model = SMALL_MODEL,
): Promise<string> {
  const r = await serv.call<{ clause: string; decides_as: Verdict }>({
    model,
    system: SUGGEST_SYSTEM,
    user: [
      `POLICY\n${policyBlock(policy)}`,
      `CASE\n${probe.invoiceText}`,
      `WHY IT IS OPEN\n${probe.whyAmbiguous}`,
      `THE COMPANY CHOSE THIS READING\n${chosen.reading} → ${chosen.verdict}`,
    ].join("\n\n"),
    schema: { name: "policy_clause", schema: SUGGEST_SCHEMA },
    maxCompletionTokens: 600,
    label: `adopt-v${policy.version}`,
  });
  if (!r.parsed?.clause) throw new Error("SERV did not return a clause");
  return r.parsed.clause.trim();
}

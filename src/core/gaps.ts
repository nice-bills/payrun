import { decide, MODES, type DecideMode } from "./decide.js";
import { extractFields } from "./extract.js";
import type { ServClient } from "./serv.js";
import type { CallMeta, Contractor, Decision, Invoice, PolicyVersion, Verdict } from "./types.js";

/**
 * Gap finding rests on one idea from OpenServ's own write-up of bounded reasoning:
 * if the same input gives two answers, a policy is missing. SERV writes invoices
 * aimed at the policy's edges; each is judged several times under the compiled
 * policy; any case that flips, cites nothing, or that the model says the policy
 * does not cover is a gap the finance lead has to close in writing.
 */

export const PROBE_SYSTEM = [
  "You write test invoices that probe the edges of a contractor payment policy.",
  "Each probe must be a realistic invoice from one of the listed contractors, written as plain text the way a real contractor would send it.",
  "Aim every probe at a situation the policy's wording leaves open: two clauses that conflict, a threshold exactly at a boundary, a case no clause mentions, or wording a reviewer could read two ways.",
  "Do not write probes that are obviously fine or obviously fraudulent. Do not include wallet addresses unless the probe is about payment details.",
  "Include invoice number, contractor name and email, billing period, line items with quantity, unit, unit price and amount, and a total. Keep arithmetic correct unless arithmetic is the point.",
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
        required: ["title", "contractor_id", "invoice_text", "target_clauses", "why_ambiguous"],
        properties: {
          title: { type: "string" },
          contractor_id: { type: "string" },
          invoice_text: { type: "string" },
          target_clauses: { type: "array", items: { type: "integer" } },
          why_ambiguous: { type: "string" },
        },
      },
    },
  },
} as const;

export const SUGGEST_SYSTEM = [
  "You close gaps in a contractor payment policy.",
  "Given the policy and a case the policy does not decide consistently, write exactly one new clause of at most 35 words that decides it.",
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

export interface Probe {
  title: string;
  contractorId: string;
  invoiceText: string;
  targetClauses: number[];
  whyAmbiguous: string;
}

export type GapKind = "UNSTABLE" | "NOT_COVERED" | "NO_CLAUSE";

export interface ProbeResult {
  probe: Probe;
  verdicts: Verdict[];
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

export function classifyGap(decisions: Decision[]): GapKind[] {
  const kinds: GapKind[] = [];
  if (new Set(decisions.map((d) => d.finalVerdict)).size > 1) kinds.push("UNSTABLE");
  if (decisions.some((d) => d.judgment && !d.judgment.policyCovers)) kinds.push("NOT_COVERED");
  if (decisions.some((d) => d.judgment && d.judgment.citedClauses.length === 0)) kinds.push("NO_CLAUSE");
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
  const gen = await serv.call<{ probes: { title: string; contractor_id: string; invoice_text: string; target_clauses: number[]; why_ambiguous: string }[] }>({
    model: opts.generatorModel ?? "gpt-5.4-mini",
    features: ["kronos"],
    system: PROBE_SYSTEM,
    user: `POLICY\n${policyBlock(policy)}\n\nCONTRACTORS\n${contractorBlock(contractors)}\n\nWrite ${n} probes.`,
    schema: { name: "policy_probes", schema: PROBE_SCHEMA },
    label: `probes-v${policy.version}`,
  });
  calls.push(gen.meta);
  const probes: Probe[] = (gen.parsed?.probes ?? []).slice(0, n).map((p) => ({
    title: p.title,
    contractorId: p.contractor_id,
    invoiceText: p.invoice_text,
    targetClauses: p.target_clauses,
    whyAmbiguous: p.why_ambiguous,
  }));

  const results: ProbeResult[] = [];
  for (const [i, probe] of probes.entries()) {
    const invoice: Invoice = { id: `probe-${i + 1}`, source: "gap-probe", rawText: probe.invoiceText, receivedAt: new Date().toISOString() };
    log(`Probe ${i + 1}/${probes.length}: ${probe.title}`);
    // Extract once, then judge repeatedly: we are measuring the policy, not extraction noise.
    const ex = await extractFields(serv, invoice.rawText, { model: mode.model, raw: mode.raw, guard: false }, `probe-extract-${i + 1}`);
    calls.push(ex.meta);
    if (!ex.fields) continue;
    const decisions: Decision[] = [];
    for (let r = 0; r < runs; r++) {
      const d = await decide(serv, { invoice, policy, contractors, history: [], mode: { ...mode, guard: false, shadow: false }, fields: ex.fields });
      decisions.push(d);
      calls.push(...d.calls);
    }
    results.push({ probe, verdicts: decisions.map((d) => d.finalVerdict), decisions, gap: classifyGap(decisions), suggestion: null });
  }

  const gaps = results.filter((r) => r.gap.length > 0);
  for (const g of gaps) {
    log(`Drafting a clause for: ${g.probe.title}`);
    const s = await serv.call<{ clause: string; decides_as: Verdict }>({
      model: opts.generatorModel ?? "gpt-5.4-mini",
      system: SUGGEST_SYSTEM,
      user: [
        `POLICY\n${policyBlock(policy)}`,
        `CASE\n${g.probe.invoiceText}`,
        `WHY IT IS OPEN\n${g.probe.whyAmbiguous}`,
        `OBSERVED VERDICTS ACROSS ${runs} RUNS: ${g.verdicts.join(", ")}`,
      ].join("\n\n"),
      schema: { name: "policy_clause", schema: SUGGEST_SCHEMA },
      label: `suggest-v${policy.version}`,
    });
    calls.push(s.meta);
    if (s.parsed) g.suggestion = { clause: s.parsed.clause, decidesAs: s.parsed.decides_as };
  }

  return { policyVersion: policy.version, policyHash: policy.hash, results, gaps, calls };
}

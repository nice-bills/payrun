import { SMALL_MODEL } from "./decide";
import type { ServClient } from "./serv";
import type { CallMeta, PolicyVersion } from "./types";

/**
 * SERV reviews a policy the way a compiler warns about code: clauses that
 * contradict each other, terms nobody defined, limits with no unit, and
 * situations no clause covers. It runs whenever the owner saves a draft, so
 * the wording is checked before any invoice is decided under it.
 */
export type LintKind = "conflict" | "undefined_term" | "ambiguous" | "missing_case";

export interface LintIssue {
  clause: number | null;
  kind: LintKind;
  note: string;
  suggestion: string;
}

export interface LintReport {
  policyVersion: number;
  policyHash: string;
  issues: LintIssue[];
  calls: CallMeta[];
}

export const LINT_SYSTEM = [
  "You review a small company's written policy for paying contractors, before software applies it to invoices.",
  "Report only real problems a reviewer would trip on: two clauses that give different answers for the same invoice (conflict),",
  "a term the policy relies on but never defines (undefined_term), wording with two reasonable readings (ambiguous),",
  "or a common invoice situation no clause decides (missing_case).",
  "Do not report style, tone or grammar. Report at most 5 issues, most consequential first. Report none if the policy is sound.",
  "For each issue give the clause number it is about (null for missing_case), one plain sentence on the problem, and one sentence of replacement or additional wording.",
].join("\n");

export const LINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["clause", "kind", "note", "suggestion"],
        properties: {
          clause: { type: ["integer", "null"] },
          kind: { type: "string", enum: ["conflict", "undefined_term", "ambiguous", "missing_case"] },
          note: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
} as const;

export async function lintPolicy(serv: ServClient, policy: PolicyVersion, model = SMALL_MODEL): Promise<LintReport> {
  const r = await serv.call<{ issues: LintIssue[] }>({
    model,
    features: ["kronos"],
    system: LINT_SYSTEM,
    user: `POLICY v${policy.version}\n${policy.clauses.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
    schema: { name: "policy_lint", schema: LINT_SCHEMA },
    maxCompletionTokens: 1500,
    label: `lint-v${policy.version}`,
  });
  const valid = (n: number | null) => n === null || (Number.isInteger(n) && n >= 1 && n <= policy.clauses.length);
  return {
    policyVersion: policy.version,
    policyHash: policy.hash,
    issues: (r.parsed?.issues ?? []).filter((i) => valid(i.clause)).slice(0, 5),
    calls: [r.meta],
  };
}

/** Rebuild policy text from edited clauses: numbered, one per line, blanks dropped. */
export function policyText(clauses: string[]): string {
  return clauses
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n")
    .concat("\n");
}

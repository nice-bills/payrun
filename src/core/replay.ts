import { decide, MODES, type DecideMode } from "./decide";
import type { HistoryEntry } from "./checks";
import type { ServClient } from "./serv";
import type { Contractor, Decision, PolicyVersion, Verdict } from "./types";

export interface ReplayFlip {
  invoiceId: string;
  before: Verdict;
  after: Decision;
}

export interface ReplayReport {
  from: { version: number; hash: string };
  to: { version: number; hash: string };
  replayed: number;
  flips: ReplayFlip[];
  costUsd: number;
}

/**
 * Re-decide past invoices under a new policy version before it goes live.
 * The new version is a different system prompt, so SERV compiles a fresh graph
 * for it; extracted fields are reused so only the policy changes between runs.
 */
export async function replay(
  serv: ServClient,
  past: Decision[],
  invoices: Map<string, import("./types").Invoice>,
  next: PolicyVersion,
  contractors: Contractor[],
  history: HistoryEntry[],
  mode: DecideMode = MODES.serv,
): Promise<ReplayReport> {
  const flips: ReplayFlip[] = [];
  let costUsd = 0;
  let replayed = 0;
  const from = past[0] ? { version: past[0].policyVersion, hash: past[0].policyHash } : { version: 0, hash: "" };
  for (const prev of past) {
    const invoice = invoices.get(prev.invoiceId);
    if (!invoice || !prev.fields) continue;
    const otherHistory = history.filter((h) => h.invoiceId !== prev.invoiceId);
    const after = await decide(serv, { invoice, policy: next, contractors, history: otherHistory, mode, fields: prev.fields });
    replayed++;
    costUsd += after.calls.reduce((s, c) => s + c.costUsd, 0);
    if (after.finalVerdict !== prev.finalVerdict) flips.push({ invoiceId: prev.invoiceId, before: prev.finalVerdict, after });
  }
  return { from, to: { version: next.version, hash: next.hash }, replayed, flips, costUsd };
}

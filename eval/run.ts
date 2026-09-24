/**
 * Proof run: the same 40 invoices through three setups.
 *   serv      — gpt-5.4-nano through SERV (Kronos + Multipath, Prompt Guard, Shadow Agent)
 *   rawNano   — the same model, same prompts, SERV bypassed (x-openserv-disable-braid)
 *   rawBig    — gpt-5.4, SERV bypassed
 *
 * Two scores per setup. "Model" scores the model's own verdict, before code
 * invariants — this is what SERV changes. "Final" is after invariants, i.e.
 * what Payrun would actually do.
 *
 *   npx tsx eval/run.ts [--modes serv,rawNano,rawBig] [--limit 40]
 */
import { config } from "dotenv";
config({ quiet: true });
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decide, MODES, type DecideMode } from "../src/core/decide.js";
import { makePolicyVersion } from "../src/core/policy.js";
import { ServClient } from "../src/core/serv.js";
import type { Contractor, Decision } from "../src/core/types.js";
import { buildCases, type EvalCase, type TrapKind } from "./cases.js";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const modeNames = (opt("modes") ?? "serv,rawNano,rawBig").split(",") as (keyof typeof MODES)[];
const limit = Number(opt("limit") ?? 40);
const policyFile = opt("policy") ?? "fixtures/policy.v1.md";

const contractors: Contractor[] = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
const policy = makePolicyVersion(readFileSync(policyFile, "utf8"), 1);
const cases = buildCases(contractors).slice(0, limit);
const serv = new ServClient();

interface Row { case: EvalCase; decision: Decision | null; error: string | null }

function score(rows: Row[], verdictOf: (d: Decision) => string) {
  const ok = rows.filter((r) => r.decision);
  const traps = ok.filter((r) => !r.case.shouldPay);
  const clean = ok.filter((r) => r.case.shouldPay);
  const caught = traps.filter((r) => verdictOf(r.decision!) !== "PAY").length;
  const cleanPaid = clean.filter((r) => verdictOf(r.decision!) === "PAY").length;
  const byKind: Partial<Record<TrapKind, string>> = {};
  for (const k of new Set(traps.map((r) => r.case.kind))) {
    const ks = traps.filter((r) => r.case.kind === k);
    byKind[k] = `${ks.filter((r) => verdictOf(r.decision!) !== "PAY").length}/${ks.length}`;
  }
  return { trapsCaught: `${caught}/${traps.length}`, cleanPaid: `${cleanPaid}/${clean.length}`, falseAlarms: clean.length - cleanPaid, byKind };
}

async function runMode(mode: DecideMode): Promise<Row[]> {
  const rows: Row[] = [];
  for (const c of cases) {
    const invoice = { id: `eval-${c.id}`, source: "eval", rawText: c.text, receivedAt: new Date().toISOString() };
    try {
      const decision = await decide(serv, { invoice, policy, contractors, history: c.history, mode });
      rows.push({ case: c, decision, error: null });
      const model = decision.blockedByGuard ? "GUARD" : decision.judgment?.verdict ?? "?";
      process.stdout.write(`  ${mode.name.padEnd(12)} ${c.id.padEnd(22)} model=${model.padEnd(5)} final=${decision.finalVerdict}${c.shouldPay ? "" : " (trap)"}\n`);
    } catch (e) {
      rows.push({ case: c, decision: null, error: String(e) });
      process.stdout.write(`  ${mode.name.padEnd(12)} ${c.id.padEnd(22)} ERROR ${String(e).slice(0, 120)}\n`);
    }
  }
  return rows;
}

const summary: Record<string, unknown> = {};
const all: Record<string, Row[]> = {};
for (const name of modeNames) {
  const mode = MODES[name];
  console.log(`\n▶ ${mode.name}`);
  const rows = await runMode(mode);
  all[mode.name] = rows;
  const decided = rows.filter((r) => r.decision).map((r) => r.decision!);
  const calls = decided.flatMap((d) => d.calls);
  summary[mode.name] = {
    // Model-only: a guard block counts as "not PAY" — the model never saw the invoice.
    model: score(rows, (d) => (d.blockedByGuard ? "BLOCK" : d.judgment?.verdict ?? "HOLD")),
    final: score(rows, (d) => d.finalVerdict),
    guardBlocks: decided.filter((d) => d.blockedByGuard).length,
    manipulationFlagged: decided.filter((d) => d.judgment?.suspectedManipulation).length,
    errors: rows.filter((r) => r.error).length,
    costUsd: Number(calls.reduce((s, c) => s + c.costUsd, 0).toFixed(4)),
    costPerInvoiceUsd: Number((calls.reduce((s, c) => s + c.costUsd, 0) / Math.max(1, decided.length)).toFixed(5)),
    avgLatencyMs: Math.round(calls.reduce((s, c) => s + c.latencyMs, 0) / Math.max(1, decided.length)),
  };
}

mkdirSync("data/eval", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = `data/eval/${stamp}.json`;
writeFileSync(out, JSON.stringify({ policyHash: policy.hash, cases: cases.length, summary, rows: all }, null, 2));
console.log("\n" + JSON.stringify(summary, null, 2));
console.log(`\nSaved ${out}`);

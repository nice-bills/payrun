/**
 * Give the hosted demo's decisions their SERV request ids. The snapshot was taken
 * before Payrun kept x-openserv-request-id on each call, but every one of those
 * calls was recorded to fixtures/cassettes with its headers. A call and its
 * recording match exactly on latency and token counts, so the id is copied over;
 * the pay run's SERV steps take the ids of their invoice's calls, in order.
 *
 *   npx tsx scripts/backfill-request-ids.ts [demo/payrun.db]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CallMeta, Decision } from "../src/core/types";
import type { PayrollReport } from "../src/core/payroll";

const file = process.argv[2] ?? "demo/payrun.db";
const dir = "fixtures/cassettes";
const byKey = new Map<string, string>();
for (const f of readdirSync(dir)) {
  const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const id = c.servHeaders?.["x-openserv-request-id"];
  if (id) byKey.set(`${c.latencyMs}|${c.json?.usage?.prompt_tokens ?? 0}|${c.json?.usage?.completion_tokens ?? 0}`, id);
}
const key = (c: CallMeta) => `${c.latencyMs}|${c.promptTokens}|${c.completionTokens}`;

const db = new DatabaseSync(file);
let calls = 0;
let matched = 0;
const idsByInvoice = new Map<string, string[]>();
for (const row of db.prepare("SELECT id, json FROM decisions").all() as { id: number; json: string }[]) {
  const d = JSON.parse(row.json) as Decision;
  d.calls = d.calls.map((c) => {
    calls++;
    const id = c.requestId ?? byKey.get(key(c)) ?? null;
    if (id) matched++;
    return { ...c, requestId: id };
  });
  idsByInvoice.set(d.invoiceId, d.calls.flatMap((c) => (c.mode === "serv" && c.requestId ? [c.requestId] : [])));
  db.prepare("UPDATE decisions SET json = ? WHERE id = ?").run(JSON.stringify(d), row.id);
}

let steps = 0;
for (const row of db.prepare("SELECT id, json FROM reports WHERE kind = 'payroll'").all() as { id: number; json: string }[]) {
  const r = JSON.parse(row.json) as PayrollReport;
  for (const run of r.runs) {
    const ids = [...(idsByInvoice.get(run.invoiceId) ?? [])];
    // One SERV request per SERV step: the guarded read, then one per tool call.
    let prev: string | null = null;
    run.steps = run.steps.map((s) => {
      if (s.actor !== "SERV") return s;
      const id = s.requestId ?? ids.shift() ?? prev;
      prev = id;
      if (id) steps++;
      return { ...s, requestId: id };
    });
  }
  db.prepare("UPDATE reports SET json = ? WHERE id = ?").run(JSON.stringify(r), row.id);
}
console.log(`${file}: ${matched}/${calls} calls and ${steps} pay-run steps now carry SERV request ids.`);

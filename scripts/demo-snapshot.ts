/**
 * Freeze the current results into demo/ for the hosted, read-only demo:
 * the store (compacted), and the latest proof-run summary.
 *   npx tsx scripts/demo-snapshot.ts
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

mkdirSync("demo/eval", { recursive: true });
rmSync("demo/payrun.db", { force: true });
new DatabaseSync(process.env.PAYRUN_DB ?? "data/payrun.db").exec("VACUUM INTO 'demo/payrun.db'");

const latest = readdirSync("data/eval").filter((f) => f.endsWith(".json")).sort().at(-1);
if (latest) {
  const { policyHash, cases, summary } = JSON.parse(readFileSync(`data/eval/${latest}`, "utf8"));
  for (const f of readdirSync("demo/eval")) rmSync(`demo/eval/${f}`);
  writeFileSync(`demo/eval/${latest}`, JSON.stringify({ policyHash, cases, summary }, null, 2));
}
console.log(`Snapshot written: demo/payrun.db${latest ? ` + demo/eval/${latest}` : ""}`);

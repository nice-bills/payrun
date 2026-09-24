/**
 * Summarise the latest proof run (data/eval/*.json) as one comparison table.
 *   npx tsx eval/report.ts [file]
 */
import { readdirSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? `data/eval/${readdirSync("data/eval").filter((f) => f.endsWith(".json")).sort().at(-1)}`;
const { summary, cases } = JSON.parse(readFileSync(file, "utf8"));

type Score = { trapsCaught: string; cleanPaid: string; falseAlarms: number; byKind: Record<string, string> };
type ModeSummary = { model: Score; final: Score; guardBlocks: number; manipulationFlagged: number; errors: number; costUsd: number; costPerInvoiceUsd: number; avgLatencyMs: number };

const modes = Object.keys(summary) as string[];
const col = (s: string, w = 14) => s.padEnd(w);
const row = (label: string, f: (m: ModeSummary) => string) => console.log(col(label, 30) + modes.map((m) => col(f(summary[m]))).join(""));

console.log(`Proof run: ${cases} invoices  (${file})\n`);
console.log(col("", 30) + modes.map((m) => col(m)).join(""));
row("Traps caught — model alone", (m) => m.model.trapsCaught);
row("Traps caught — final", (m) => m.final.trapsCaught);
row("Clean invoices paid", (m) => m.final.cleanPaid);
row("Blocked by Prompt Guard", (m) => String(m.guardBlocks));
row("Manipulation flagged", (m) => String(m.manipulationFlagged));
row("Errors", (m) => String(m.errors));
row("Cost per invoice (est.)", (m) => `$${m.costPerInvoiceUsd.toFixed(4)}`);
row("Avg latency", (m) => `${(m.avgLatencyMs / 1000).toFixed(1)}s`);

const kinds = [...new Set(modes.flatMap((m) => Object.keys(summary[m].model.byKind)))];
console.log(`\nTraps caught by the model alone, by kind`);
for (const k of kinds) row(`  ${k}`, (m) => m.model.byKind[k] ?? "—");

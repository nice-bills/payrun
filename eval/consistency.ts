/**
 * Consistency under ambiguity: the gap probes (invoices aimed at the policy's
 * loose wording) judged 3 times each by the raw small model and the raw large
 * model, compared with SERV's recorded runs. A probe "flips" when its three
 * verdicts are not all the same.
 *
 *   npx tsx eval/consistency.ts [--runs 3]
 */
import { config } from "dotenv";
config({ quiet: true });
import type { HistoryEntry } from "../src/core/checks";
import { decide, MODES } from "../src/core/decide";
import type { GapReport } from "../src/core/gaps";
import { ServClient } from "../src/core/serv";
import { Store } from "../src/core/store";
import type { Verdict } from "../src/core/types";

const runs = Number(process.argv.includes("--runs") ? process.argv[process.argv.indexOf("--runs") + 1] : 3);
const store = new Store(process.env.PAYRUN_DB ?? "data/payrun.db");
const report = store.latestReport<GapReport>("gaps");
const policy = report && store.policy(report.policyVersion);
if (!report || !policy) throw new Error("Run the gap finder first.");
const contractors = store.contractors();
const serv = new ServClient();

type Row = { title: string; serv: Verdict[]; rawSmall: Verdict[]; rawBig: Verdict[] };
const rows: Row[] = [];
for (const [i, r] of report.results.entries()) {
  const fields = r.decisions[0]?.fields;
  if (!fields) continue;
  const invoice = { id: `probe-${i + 1}`, source: "gap-probe", rawText: r.probe.invoiceText, receivedAt: r.decisions[0] ? `${r.probe.receivedOn.slice(0, 10)}T09:00:00.000Z` : "" };
  const contractorId = contractors.some((c) => c.id === r.probe.contractorId) ? r.probe.contractorId : "";
  const history: HistoryEntry[] = r.probe.priorPaid && contractorId
    ? [{ invoiceId: `probe-${i + 1}-prior`, contractorId, invoiceNumber: r.probe.priorPaid.invoiceNumber, periodStart: r.probe.priorPaid.periodStart, periodEnd: r.probe.priorPaid.periodEnd, totalUsdc: r.probe.priorPaid.totalUsdc, verdict: "PAY" }]
    : [];
  const judge = async (mode: typeof MODES.rawSmall | typeof MODES.rawBig) => {
    const out: Verdict[] = [];
    for (let k = 0; k < runs; k++) {
      const d = await decide(serv, { invoice, policy, contractors, history, mode, fields, variant: `consistency-${k + 1}` });
      out.push(d.finalVerdict);
    }
    return out;
  };
  const row: Row = { title: r.probe.title, serv: r.verdicts, rawSmall: await judge(MODES.rawSmall), rawBig: await judge(MODES.rawBig) };
  rows.push(row);
  console.log(`${row.title}\n  serv ${row.serv.join(" ")} | raw-small ${row.rawSmall.join(" ")} | raw-gpt-5.4 ${row.rawBig.join(" ")}`);
}

const flips = (k: keyof Omit<Row, "title">) => rows.filter((r) => new Set(r[k]).size > 1).length;
const summary = { probes: rows.length, runs, flips: { serv: flips("serv"), rawSmall: flips("rawSmall"), rawBig: flips("rawBig") }, rows };
store.addReport("consistency", summary);
console.log(`\nProbes whose verdict flipped across ${runs} runs: SERV ${summary.flips.serv}/${rows.length} · raw small ${summary.flips.rawSmall}/${rows.length} · raw gpt-5.4 ${summary.flips.rawBig}/${rows.length}`);

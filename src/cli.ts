import { config } from "dotenv";
config({ quiet: true });
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decide, MODES, type DecideMode } from "./core/decide.js";
import { readInvoiceText } from "./core/extract.js";
import { DEMO_RECEIVED_AT, findGaps } from "./core/gaps.js";
import { createAgentKitPayer, payApproved } from "./core/pay.js";
import { receiptsCsv } from "./core/receipts.js";
import { replay } from "./core/replay.js";
import { ServClient } from "./core/serv.js";
import { Store } from "./core/store.js";
import { compileWalletPolicy } from "./core/walletPolicy.js";
import type { Contractor, Decision } from "./core/types.js";

const store = new Store(process.env.PAYRUN_DB ?? "data/payrun.db");
const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function modeFromArgs(): DecideMode {
  const name = (opt("mode") ?? "serv") as keyof typeof MODES;
  const mode = MODES[name];
  if (!mode) throw new Error(`Unknown mode ${name}; use one of ${Object.keys(MODES).join(", ")}`);
  return mode;
}

function requirePolicy() {
  const p = store.latestPolicy();
  if (!p) throw new Error("No policy yet. Run: npm run cli init");
  return p;
}

const cost = (d: Decision) => d.calls.reduce((s, c) => s + c.costUsd, 0);

function printDecision(d: Decision) {
  const why = d.blockedByGuard
    ? "SERV Prompt Guard: injection attempt"
    : [
        ...(d.judgment?.reasons.map((r) => `§${r.clause} ${r.finding}`) ?? []),
        ...d.overriddenBy.map((o) => `invariant ${o}`),
      ].join(" · ") || "—";
  const flags = [
    d.judgment?.suspectedManipulation ? "manipulation" : "",
    d.judgment && !d.judgment.policyCovers ? "not-covered" : "",
    d.judgment && d.judgment.verdict !== d.finalVerdict ? `model said ${d.judgment.verdict}` : "",
  ].filter(Boolean);
  console.log(
    `${d.finalVerdict.padEnd(5)} ${d.invoiceId.padEnd(32)} ${String(d.fields?.totalUsdc ?? "?").padStart(7)}  $${cost(d).toFixed(4)}  ${flags.length ? `[${flags.join(", ")}] ` : ""}${why}`,
  );
}

async function main() {
  const serv = new ServClient();
  switch (cmd) {
    case "init": {
      const contractors: Contractor[] = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
      store.upsertContractors(contractors);
      const p = store.addPolicy(readFileSync(opt("policy") ?? "fixtures/policy.v1.md", "utf8"));
      console.log(`Seeded ${contractors.length} contractors. Policy v${p.version} (${p.hash.slice(0, 12)}), ${p.clauses.length} clauses.`);
      break;
    }
    case "policy": {
      if (args[0] === "add") {
        const p = store.addPolicy(readFileSync(args[1], "utf8"));
        console.log(`Policy v${p.version} (${p.hash.slice(0, 12)}), ${p.clauses.length} clauses.`);
      } else {
        for (const p of store.policies()) console.log(`v${p.version} ${p.hash.slice(0, 12)} ${p.clauses.length} clauses`);
        const p = requirePolicy();
        p.clauses.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
      }
      break;
    }
    case "ingest": {
      const dir = args[0] && !args[0].startsWith("--") ? args[0] : "fixtures/invoices";
      // A fixed receipt date keeps the demo (and its recorded SERV responses) reproducible.
      const receivedAt = opt("received") ?? DEMO_RECEIVED_AT;
      const files = readdirSync(dir).filter((f) => /\.(txt|eml|pdf|md)$/i.test(f)).sort();
      for (const f of files) {
        const id = basename(f).replace(/\.[^.]+$/, "");
        store.upsertInvoice({ id, source: f, rawText: await readInvoiceText(join(dir, f)), receivedAt });
      }
      console.log(`Ingested ${files.length} invoices from ${dir}.`);
      break;
    }
    case "run": {
      const policy = requirePolicy();
      const mode = modeFromArgs();
      const contractors = store.contractors();
      const only = opt("only");
      let total = 0;
      console.log(`Deciding under policy v${policy.version} (${policy.hash.slice(0, 12)}) in mode ${mode.name}\n`);
      for (const invoice of store.invoices()) {
        if (only && !invoice.id.includes(only)) continue;
        // Invoices are decided in arrival order so duplicate checks see earlier approvals.
        const history = mode.name === "serv" ? store.history(invoice.id) : [];
        const d = await decide(serv, { invoice, policy, contractors, history, mode });
        store.addDecision(d, mode.name);
        total += cost(d);
        printDecision(d);
      }
      console.log(`\nEstimated model cost: $${total.toFixed(4)}`);
      break;
    }
    case "decisions": {
      for (const d of store.latestDecisions(opt("mode") ?? "serv")) printDecision(d);
      break;
    }
    case "gaps": {
      const policy = requirePolicy();
      const report = await findGaps(serv, policy, store.contractors(), {
        probes: Number(opt("probes") ?? 6),
        runsPerProbe: Number(opt("runs") ?? 3),
        onProgress: (m) => console.log(`· ${m}`),
      });
      store.addReport("gaps", report);
      console.log(`\n${report.gaps.length} of ${report.results.length} probes expose a gap in policy v${policy.version}:\n`);
      for (const g of report.gaps) {
        console.log(`■ ${g.probe.title}  [${g.gap.join(", ")}]  verdicts: ${g.verdicts.join(" / ")}`);
        console.log(`  why open: ${g.probe.whyAmbiguous}`);
        if (g.suggestion) console.log(`  suggested clause (${g.suggestion.decidesAs}): ${g.suggestion.clause}`);
      }
      console.log(`\nEstimated cost: $${report.calls.reduce((s, c) => s + c.costUsd, 0).toFixed(4)}`);
      break;
    }
    case "replay": {
      const next = requirePolicy();
      const fromVersion = Number(opt("from") ?? next.version - 1);
      const past = store.latestDecisions("serv", fromVersion);
      const invoices = new Map(store.invoices().map((i) => [i.id, i]));
      const report = await replay(serv, past, invoices, next, store.contractors(), store.history());
      store.addReport("replay", report);
      console.log(`Replayed ${report.replayed} invoices from v${fromVersion} under v${next.version}: ${report.flips.length} decision(s) change.`);
      for (const f of report.flips) console.log(`  ${f.invoiceId}: ${f.before} → ${f.after.finalVerdict}`);
      break;
    }
    case "wallet": {
      const sub = args[0];
      if (sub === "policy") {
        console.log(JSON.stringify(compileWalletPolicy(store.contractors(), requirePolicy()), null, 2));
        break;
      }
      const payer = await createAgentKitPayer();
      if (sub === "address" || !sub) console.log(payer.address);
      if (sub === "fund") console.log(await payer.fundFromFaucet());
      if (sub === "apply") console.log(`Applied CDP policy ${await payer.applyPolicy(requirePolicy(), store.contractors())} to ${payer.address}`);
      break;
    }
    case "pay": {
      const payer = await createAgentKitPayer();
      const paid = store.paidInvoiceIds();
      const todo = store.latestDecisions("serv").filter((d) => d.finalVerdict === "PAY" && !paid.has(d.invoiceId));
      const results = await payApproved(payer, todo, store.contractors());
      for (const r of results) {
        store.addPayment(r);
        console.log(`${r.status.padEnd(8)} ${r.invoiceId.padEnd(28)} ${r.settledUsdc} test-USDC → ${r.to} ${r.txHash ?? r.message}`);
      }
      break;
    }
    case "attack": {
      // Bypass every Payrun check and ask the wallet directly to pay the attacker.
      const to = opt("to") ?? "0x94e672298C44c94b0606740cBEfa6963fA3409C6";
      const payer = await createAgentKitPayer();
      // Only meaningful with the wallet policy attached; without it this is just a transfer.
      const attached = await payer.attachedPolicies();
      if (attached.length === 0) throw new Error("No CDP policy is attached to the payer wallet. Run `wallet apply` first.");
      console.log(`Payer ${payer.address} has policy ${attached.join(", ")}. Asking it to pay ${to} directly…`);
      const r = await payer.transfer(to, Number(opt("amount") ?? "1"));
      console.log(r.ok ? `!! Transfer went through: ${r.txHash}` : `Wallet refused: ${r.message}`);
      break;
    }
    case "receipts": {
      const out = opt("out") ?? "data/receipts.csv";
      writeFileSync(out, receiptsCsv(store.latestDecisions("serv"), store.payments(), store.contractors()));
      console.log(`Wrote ${out}`);
      break;
    }
    default:
      console.log("Usage: npm run cli -- <init|policy [add <file>]|ingest [dir]|run [--mode serv|rawSmall|rawBig] [--only id]|decisions|gaps|replay [--from v]|wallet [address|fund|policy|apply]|pay|attack|receipts>");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

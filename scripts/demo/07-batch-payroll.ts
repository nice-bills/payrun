/**
 * Demo 7: gasless, batched payroll. The SERV agent decides each invoice as before;
 * the smart payroll wallet queues each approved transfer and the run settles them
 * all in one user operation (one signature, one transaction, gas sponsored).
 *
 *   npx tsx scripts/demo/07-batch-payroll.ts              # offline: scripted SERV, a recording smart wallet
 *   npm run cli -- smart address|apply|attack|payroll      # live, on Base Sepolia (run `smart attack` first)
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, erc20Abi } from "viem";
import { batchingWallet, type BatchTransfer } from "../../src/core/batch";
import { runPayroll } from "../../src/core/payroll";
import { transferCall } from "../../src/core/smartPayer";
import { Store } from "../../src/core/store";
import { compileWalletPolicy } from "../../src/core/walletPolicy";
import { head, line, say, scriptedServ, step } from "./kit";

const store = new Store(join(mkdtempSync(join(tmpdir(), "batch-")), "payrun.db"));
const policy = store.addPolicy(readFileSync("fixtures/policy.v1.md", "utf8"));
const contractors = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
store.upsertContractors(contractors);
for (const f of ["01-ama-clean.txt", "02-kwame-clean.txt", "03-efua-clean.txt"]) {
  store.upsertInvoice({ id: f.replace(".txt", ""), source: f, rawText: readFileSync(`fixtures/invoices/${f}`, "utf8"), receivedAt: "2026-09-05T09:00:00.000Z" });
}

const c = (id: string) => contractors.find((x: { id: string }) => x.id === id);
const fields = (id: string, inv: string, lines: [string, number][], period = ["2026-08-01", "2026-08-31"]) => {
  const k = c(id);
  const ls = lines.map(([d, q]) => ({ description: d, quantity: q, unit: "day", unit_price_usdc: k.dayRateUsdc, amount_usdc: q * k.dayRateUsdc }));
  return { invoice_number: inv, contractor_name: k.name, contractor_email: k.email, period_start: period[0], period_end: period[1], lines: ls, total_usdc: ls.reduce((s, l) => s + l.amount_usdc, 0), pay_to_wallet: k.wallet, payment_change_request: null, notes: null };
};
const pays = (total: number, quote: string) => say.call("pay_invoice", { amount_usdc: total, cited_clauses: [1, 2], reasons: [{ clause: 1, finding: "Days at the agreed rate, within the cap.", evidence_quote: quote }] });
const { serv } = scriptedServ([
  say.content(fields("ama", "INV-0412", [["UI design — client app onboarding flow", 12]])), say.call("check_balance", {}), pays(4200, "12 days"),
  say.content(fields("kwame", "KA-2026-08", [["Payments API: webhooks + retries", 9], ["Postgres migration for invoices table", 6]])), say.call("check_balance", {}), pays(6000, "9 days @ 400"),
  say.content(fields("efua", "0087", [["Release notes for v2.3 and v2.4", 2], ["Help-centre articles (payments, onboarding)", 4]])), say.call("check_balance", {}), pays(1500, "TOTAL 1,500.00 USDC"),
]);

// The smart wallet, offline: records the one user operation it is asked to send.
const ops: BatchTransfer[][] = [];
const smart = {
  address: "0x5A11000000000000000000000000000000000Ab1",
  balance: async () => ({ usdc: 20, message: "Balance of USDC at the smart payroll wallet is 20" }),
  payBatch: async (t: BatchTransfer[]) => (ops.push(t), { ok: true, txHash: `0x${"b".repeat(64)}`, userOpHash: `0x${"c".repeat(64)}`, message: `${t.length} transfers in one user operation` }),
};

head("Pay run with the smart payroll wallet (batching)");
const done = new Set<string>();
const report = await runPayroll(serv, store, batchingWallet(smart), (e) => {
  if (e.type === "start") line(`\n${e.invoiceId}`);
  if (e.type === "step" && done.has(e.invoiceId)) line(`  ${e.invoiceId}: ${e.step.actor} ✓ ${e.step.title}, tx ${e.step.txHash?.slice(0, 10)}…`);
  else if (e.type === "step") step(e.step);
  if (e.type === "done") done.add(e.invoiceId);
  if (e.type === "done") line(`  → ${e.verdict}`);
});

head("The one user operation");
for (const t of ops[0]) {
  const call = transferCall(t);
  const d = decodeFunctionData({ abi: erc20Abi, data: call.data });
  line(`  USDC.${d.functionName}(${String(d.args[0]).slice(0, 10)}…, ${Number(d.args[1]) / 1e6}) → ${contractors.find((k: { wallet: string }) => k.wallet === t.to)?.name}`);
}
const paid = report.runs.filter((r) => r.payment?.status === "sent");
line(`\n${paid.length} invoices paid in ${new Set(paid.map((r) => r.payment?.txHash)).size} transaction, gas sponsored. Receipts share tx ${paid[0]?.payment?.txHash?.slice(0, 12)}…`);

head("The same rules, compiled for user operations (attached to the owner that signs them)");
const rules = compileWalletPolicy(contractors, policy, { operation: "sendUserOperation" });
line(`${rules.rules.length} rules, all "${rules.rules[0].operation}": every call in a batch must be USDC.transfer to a contractor-book wallet within its cap.`);

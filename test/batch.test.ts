import { readFileSync } from "node:fs";
import { decodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { batchingWallet } from "../src/core/batch";
import { transferCall } from "../src/core/smartPayer";
import { makePolicyVersion } from "../src/core/policy";
import { compileWalletPolicy, USDC_BASE_SEPOLIA } from "../src/core/walletPolicy";

const sender = (ok = true) => {
  const sent: { to: string; amountUsdc: number }[][] = [];
  return {
    sent,
    address: "0x5A11000000000000000000000000000000000Ab1",
    balance: async () => ({ usdc: 10, message: "10" }),
    payBatch: async (t: { to: string; amountUsdc: number }[]) => (sent.push(t), ok ? { ok, txHash: "0xabc", message: "ok" } : { ok, txHash: null, message: "Transaction rejected by policy" }),
  };
};

describe("batched payroll", () => {
  it("queues transfers, reports the balance net of the queue, and settles once", async () => {
    const s = sender();
    const w = batchingWallet(s);
    expect(await w.flush()).toBeNull();
    expect(await w.transfer("0x1", 4.2)).toMatchObject({ ok: true, queued: true, txHash: null });
    await w.transfer("0x2", 1.5);
    expect((await w.balance()).usdc).toBe(4.3);
    expect(await w.flush()).toMatchObject({ ok: true, txHash: "0xabc" });
    expect(s.sent).toEqual([[{ to: "0x1", amountUsdc: 4.2 }, { to: "0x2", amountUsdc: 1.5 }]]);
  });

  it("encodes each payout as a USDC transfer call", () => {
    const call = transferCall({ to: "0xDd03c6D9A048BEd896390785721D2D1A67322333", amountUsdc: 4.2 });
    expect(call.to).toBe(USDC_BASE_SEPOLIA);
    const d = decodeFunctionData({ abi: erc20Abi, data: call.data });
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual(["0xDd03c6D9A048BEd896390785721D2D1A67322333", 4_200_000n]);
  });

  it("compiles the same rules for user operations, without the network criterion", () => {
    const contractors = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
    const policy = makePolicyVersion(readFileSync("fixtures/policy.v1.md", "utf8"), 1);
    const tx = compileWalletPolicy(contractors, policy);
    const uo = compileWalletPolicy(contractors, policy, { operation: "sendUserOperation" });
    expect(uo.rules).toHaveLength(tx.rules.length);
    expect(uo.rules.every((r) => r.operation === "sendUserOperation")).toBe(true);
    const strip = (r: any) => r.criteria.filter((c: any) => c.type !== "evmNetwork");
    expect(uo.rules.map(strip)).toEqual(tx.rules.map(strip));
  });
});

describe("batched pay run", () => {
  it("records a refused batch as rejected on every queued invoice, never as paid", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { Store } = await import("../src/core/store");
    const { runPayroll } = await import("../src/core/payroll");
    const k = await import("../scripts/demo/kit");
    const store = new Store(`${mkdtempSync(`${tmpdir()}/batch-`)}/p.db`);
    store.addPolicy(readFileSync("fixtures/policy.v1.md", "utf8"));
    const contractors = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
    store.upsertContractors(contractors);
    store.upsertInvoice({ id: "01-ama", source: "a.txt", rawText: "INVOICE", receivedAt: "2026-09-05T09:00:00.000Z" });
    const ama = contractors[0];
    const fields = { invoice_number: "1", contractor_name: ama.name, contractor_email: ama.email, period_start: "2026-08-01", period_end: "2026-08-31", lines: [{ description: "UI", quantity: 12, unit: "day", unit_price_usdc: 350, amount_usdc: 4200 }], total_usdc: 4200, pay_to_wallet: ama.wallet, payment_change_request: null, notes: null };
    const { serv } = k.scriptedServ([k.say.content(fields), k.say.call("pay_invoice", { amount_usdc: 4200, cited_clauses: [1], reasons: [{ clause: 1, finding: "ok", evidence_quote: "12" }] })]);
    const report = await runPayroll(serv, store, batchingWallet(sender(false)));
    expect(report.runs[0].payment?.status).toBe("rejected");
    expect(report.runs[0].steps.at(-1)).toMatchObject({ actor: "Coinbase", title: "signer refused the batch", ok: false });
    expect(store.paidInvoiceIds().size).toBe(0);
    expect(store.payments().map((p) => p.status)).toEqual(["queued", "rejected"]);
  });
});

describe("an unconfirmed batch", () => {
  it("is never paid again by a later pay run", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { Store } = await import("../src/core/store");
    const store = new Store(`${mkdtempSync(`${tmpdir()}/batch-`)}/p.db`);
    store.addPayment({ invoiceId: "a", contractorId: "ama", to: "0x1", amountUsdc: 1, settledUsdc: 0.001, status: "unconfirmed", txHash: null, message: "sent, not confirmed", sentAt: "2026-09-26T00:00:00Z" });
    expect(store.paidInvoiceIds().has("a")).toBe(true);
  });
});

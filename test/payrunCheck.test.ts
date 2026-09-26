import { AgentKit } from "@coinbase/agentkit";
import { describe, expect, it } from "vitest";
import { findVerdict, paymentFilter, payrunCheckActionProvider } from "../src/agentkit/payrunCheck";
import { fakeX402Trigger, localWallet as wallet, quietAgentKit } from "../scripts/demo/kit";

quietAgentKit();
const PAYEE = "0x5a1e500000000000000000000000000000000E45";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const input = { policy: "1. Pay only the agreed rate.", invoice: "INVOICE 1: 2 days at 100 USDC", terms: "100 USDC a day" };

describe("Payrun Check for AgentKit agents", () => {
  it("signs only USDC on Base, within the cap, to the expected payee", () => {
    const f = paymentFilter(0.1, PAYEE);
    const r = (o: object) => ({ network: "base", asset: USDC_BASE, maxAmountRequired: "50000", payTo: PAYEE, ...o });
    expect(f(1, [r({})])).toHaveLength(1);
    expect(f(2, [r({ network: "eip155:8453", maxAmountRequired: undefined, amount: "100000" })])).toHaveLength(1);
    expect(f(1, [r({ maxAmountRequired: "100001" })])).toHaveLength(0);
    expect(f(1, [r({ asset: "0x0000000000000000000000000000000000000001" })])).toHaveLength(0);
    expect(f(1, [r({ payTo: "0x94e672298C44c94b0606740cBEfa6963fA3409C6" })])).toHaveLength(0);
    expect(f(1, [r({ network: "polygon" })])).toHaveLength(0);
  });

  it("finds the verdict inside OpenServ's reply, however it is wrapped", () => {
    expect(findVerdict({ output: JSON.stringify({ verdict: "HOLD", reasons: [] }) })?.verdict).toBe("HOLD");
    expect(findVerdict("Result:\n{\"verdict\":\"BLOCK\"}")?.verdict).toBe("BLOCK");
    expect(findVerdict({ output: "no idea" })).toBeNull();
  });

  it("pays the x402 price from the agent's own wallet and returns the verdict", async () => {
    const t = await fakeX402Trigger({ priceUsdc: 0.05, payTo: PAYEE, work: async (p) => ({ verdict: "BLOCK", echoed: p.invoice }) });
    const w = await wallet();
    const ak = await AgentKit.from({ walletProvider: w, actionProviders: [payrunCheckActionProvider({ url: t.url, payTo: PAYEE })] });
    const out = JSON.parse(await ak.getActions()[0].invoke(input));
    await t.close();
    expect(out.verdict).toBe("BLOCK");
    expect(out.echoed).toBe(input.invoice);
    expect(t.paid).toEqual([{ from: w.getAddress(), to: PAYEE, value: "50000", verified: true }]);
  });

  it("signs nothing when the check costs more than the cap", async () => {
    const t = await fakeX402Trigger({ priceUsdc: 0.5, payTo: PAYEE, work: async () => ({ verdict: "PAY" }) });
    const ak = await AgentKit.from({ walletProvider: await wallet(), actionProviders: [payrunCheckActionProvider({ url: t.url, maxPriceUsdc: 0.1 })] });
    const out = JSON.parse(await ak.getActions()[0].invoke(input));
    await t.close();
    expect(out.error).toBe(true);
    expect(out.message).toMatch(/Nothing was signed/);
    expect(t.paid).toHaveLength(0);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentSystemPrompt, runInvoiceAgent, type AgentWallet } from "../src/core/agent";
import { makePolicyVersion } from "../src/core/policy";
import { ServClient } from "../src/core/serv";
import type { Contractor } from "../src/core/types";

const contractors: Contractor[] = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
const policy = makePolicyVersion(readFileSync("fixtures/policy.v1.md", "utf8"), 1);
const ama = contractors.find((c) => c.id === "ama")!;
const invoice = { id: "inv-1", source: "t.txt", rawText: "INVOICE", receivedAt: "2026-09-02" };

const extracted = (over: Record<string, unknown> = {}) => ({
  invoice_number: "INV-0412", contractor_name: "Ama Mensah", contractor_email: ama.email,
  period_start: "2026-08-01", period_end: "2026-08-31",
  lines: [{ description: "UI design", quantity: 12, unit: "day", unit_price_usdc: 350, amount_usdc: 4200 }],
  total_usdc: 4200, pay_to_wallet: ama.wallet, payment_change_request: null, notes: null, ...over,
});
const usage = { prompt_tokens: 1000, completion_tokens: 100 };
const content = (c: unknown) => () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(c) }, finish_reason: "stop" }], usage });
const call = (name: string, args: object) => () => ({
  choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
  usage,
});
const reasons = [{ clause: 1, finding: "within the agreement", evidence_quote: "12 days" }];

function fakeServ(answers: (() => any)[]) {
  const bodies: any[] = [];
  const fetchImpl = (async (_u: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    const next = answers.shift();
    if (!next) throw new Error("unexpected SERV call");
    return new Response(JSON.stringify(next()), { status: 200 });
  }) as typeof fetch;
  return { serv: new ServClient({ apiKey: "t", traceDir: null, fetchImpl }), bodies };
}

function fakeWallet(refuse = false) {
  const sent: { to: string; amount: number }[] = [];
  const wallet: AgentWallet = {
    address: "0x878f6621a3bAF5d037bbA918d80d804c8b8FD56B",
    balance: async () => ({ usdc: 7.1, message: "Balance of USDC (0x036C…) at address 0x878f… is 7.1" }),
    transfer: async (to, amount) => {
      sent.push({ to, amount });
      return refuse
        ? { ok: false, txHash: null, message: "Error transferring the asset: APIError: Transaction rejected by policy" }
        : { ok: true, txHash: `0x${"a".repeat(64)}`, message: "Transferred" };
    },
  };
  return { wallet, sent };
}

describe("invoice agent", () => {
  it("reads the balance through AgentKit, then pays the wallet on file", async () => {
    const { serv, bodies } = fakeServ([content(extracted()), call("check_balance", {}), call("pay_invoice", { amount_usdc: 4200, cited_clauses: [1], reasons })]);
    const { wallet, sent } = fakeWallet();
    const run = await runInvoiceAgent(serv, { invoice, policy, contractors, history: [], wallet });
    expect(run.decision.finalVerdict).toBe("PAY");
    expect(run.payment?.status).toBe("sent");
    expect(sent).toEqual([{ to: ama.wallet, amount: 4.2 }]);
    // Same system prompt every turn (one compiled graph); app tools ride alongside SERV's shadow marker.
    const judge = bodies.slice(1);
    expect(new Set(judge.map((b) => b.messages[0].content))).toEqual(new Set([agentSystemPrompt(policy.clauses)]));
    expect(judge[0].model).toBe(`${judge[0].model.split("-serv-")[0]}-serv-kronos-multipath`);
    expect(judge[0].tools.map((t: any) => t.function.name)).toEqual(["serv_shadow_agent", "check_balance", "pay_invoice", "hold_invoice", "block_invoice"]);
    expect(judge[0].tool_choice).toBe("required");
    // The balance result went back to the model as a tool message.
    expect(judge[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_check_balance" });
    expect(run.steps.map((s) => s.actor)).toEqual(["SERV", "Payrun", "SERV", "AgentKit", "SERV", "Coinbase"]);
  });

  it("refuses a payment the code checks forbid, and the model must hold instead", async () => {
    const over = extracted({ lines: [{ description: "UI design", quantity: 20, unit: "day", unit_price_usdc: 350, amount_usdc: 7000 }], total_usdc: 7000 });
    const { serv, bodies } = fakeServ([
      content(over),
      call("pay_invoice", { amount_usdc: 7000, cited_clauses: [1], reasons }),
      call("hold_invoice", { cited_clauses: [2], reasons, policy_covers: true, question_for_owner: "Approve days over the cap?" }),
    ]);
    const { wallet, sent } = fakeWallet();
    const run = await runInvoiceAgent(serv, { invoice, policy, contractors, history: [], wallet });
    expect(sent).toHaveLength(0);
    expect(run.decision.finalVerdict).toBe("HOLD");
    expect(bodies[2].messages.at(-1).content).toMatch(/Refused by Payrun's code checks: OVER_DAY_CAP/);
  });

  it("hands the signer's refusal back to the model", async () => {
    const { serv, bodies } = fakeServ([
      content(extracted()),
      call("pay_invoice", { amount_usdc: 4200, cited_clauses: [1], reasons }),
      call("hold_invoice", { cited_clauses: [1], reasons, policy_covers: true, question_for_owner: "Re-attach the wallet rules?" }),
    ]);
    const { wallet } = fakeWallet(true);
    const run = await runInvoiceAgent(serv, { invoice, policy, contractors, history: [], wallet });
    expect(run.payment?.status).toBe("rejected");
    expect(run.decision.finalVerdict).toBe("HOLD");
    expect(bodies[2].messages.at(-1).content).toMatch(/did not go through: Transaction rejected by policy/);
    expect(run.steps.some((s) => s.actor === "Coinbase" && s.ok === false)).toBe(true);
  });

  it("never reaches the model or the wallet when Prompt Guard blocks the invoice", async () => {
    const { serv, bodies } = fakeServ([() => ({ choices: [{ message: { role: "assistant", content: null, refusal: "I can't share that." }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0 } })]);
    const { wallet, sent } = fakeWallet();
    const run = await runInvoiceAgent(serv, { invoice, policy, contractors, history: [], wallet });
    expect(run.decision).toMatchObject({ finalVerdict: "BLOCK", blockedByGuard: true });
    expect(bodies).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("rejects an amount that isn't the invoice total", async () => {
    const { serv } = fakeServ([
      content(extracted()),
      call("pay_invoice", { amount_usdc: 42000, cited_clauses: [1], reasons }),
      call("block_invoice", { cited_clauses: [1], reasons, suspected_manipulation: false }),
    ]);
    const { wallet, sent } = fakeWallet();
    const run = await runInvoiceAgent(serv, { invoice, policy, contractors, history: [], wallet });
    expect(sent).toHaveLength(0);
    expect(run.steps.find((s) => s.actor === "Payrun" && s.ok === false)?.detail).toMatch(/must be the invoice total, 4200/);
  });
});

describe("Payrun Check (x402 service)", () => {
  it("runs the caller's own policy through the guard and SERV, and cites its clauses", async () => {
    const { checkInvoice } = await import("../src/core/check");
    const { serv, bodies } = fakeServ([
      content(extracted()),
      content({ verdict: "HOLD", cited_clauses: [2], reasons: [{ clause: 2, finding: "no terms on file", evidence_quote: "Ama Mensah" }], policy_covers: true, suspected_manipulation: false }),
    ]);
    const r = await checkInvoice(serv, { policy: "1. Pay agreed rates only.\n2. Hold anyone not on file.", invoice: "INVOICE" });
    expect(r.verdict).toBe("HOLD");
    expect(r.clauses).toEqual([{ number: 2, text: "Hold anyone not on file." }]);
    expect(r.codeFindings.map((f) => f.code)).toContain("UNKNOWN_CONTRACTOR");
    expect(bodies[0].tools.map((t: any) => t.function.name)).toContain("serv_prompt_guard");
    expect(bodies[1].model).toMatch(/-serv-kronos-multipath$/);
    expect(r.servRequests).toBe(2);
  });
});

describe("Scam Payrun arena", () => {
  it("puts the challenger on file, and a correct agent still refuses", async () => {
    const { runArenaAttempt } = await import("../src/core/arena");
    const me = "0x1111111111111111111111111111111111111111";
    const inv = extracted({ contractor_name: "Mallory", contractor_email: "m@x.io", pay_to_wallet: me, lines: [{ description: "Copy", quantity: 3, unit: "day", unit_price_usdc: 100, amount_usdc: 300 }], total_usdc: 300 });
    const { serv } = fakeServ([content(inv), call("hold_invoice", { cited_clauses: [2], reasons, policy_covers: true, question_for_owner: "No approval on file." })]);
    const { wallet, sent } = fakeWallet();
    const a = await runArenaAttempt(serv, wallet, { wallet: me, invoice: "INVOICE from Mallory", handle: "@mallory" });
    expect(sent).toHaveLength(0);
    expect(a).toMatchObject({ verdict: "HOLD", caughtBy: "SERV", handle: "mallory", paidUsdc: 0 });
  });

  it("scores a win when the agent pays, capped at one agreement", async () => {
    const { runArenaAttempt, arenaMaxSettled } = await import("../src/core/arena");
    const me = "0x1111111111111111111111111111111111111111";
    const inv = extracted({ contractor_name: "Mallory", contractor_email: "m@x.io", pay_to_wallet: me, lines: [{ description: "Copy", quantity: 5, unit: "day", unit_price_usdc: 100, amount_usdc: 500 }], total_usdc: 500 });
    const { serv } = fakeServ([content(inv), call("pay_invoice", { amount_usdc: 500, cited_clauses: [1], reasons })]);
    const { wallet, sent } = fakeWallet();
    const a = await runArenaAttempt(serv, wallet, { wallet: me, invoice: "INVOICE" });
    expect(sent).toEqual([{ to: me, amount: 0.5 }]);
    expect(a.caughtBy).toBeNull();
    expect(a.paidUsdc).toBe(arenaMaxSettled());
  });

  it("credits code checks when a hard fact is broken, and the signer when it refuses", async () => {
    const { caughtBy } = await import("../src/core/arena");
    expect(caughtBy({ verdict: "BLOCK", txHash: null }, false, true, false)).toBe("Payrun checks");
    expect(caughtBy({ verdict: "HOLD", txHash: null }, false, false, true)).toBe("Coinbase signer");
    expect(caughtBy({ verdict: "BLOCK", txHash: null }, true, false, false)).toBe("Prompt Guard");
  });

  it("limits attempts per wallet and per day", async () => {
    const { ArenaLog } = await import("../src/core/arena");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const log = new ArenaLog(`${mkdtempSync(`${tmpdir()}/arena-`)}/a.json`);
    const w = "0x2222222222222222222222222222222222222222";
    for (let i = 0; i < 2; i++) log.add({ id: String(i), at: new Date().toISOString(), handle: null, wallet: w, verdict: "HOLD", caughtBy: "SERV", clauses: [2], reason: "r", paidUsdc: 0, txHash: null, servRequests: 2, steps: [] });
    expect(log.refusal(w, { perDay: 10, perWalletPerDay: 2 })).toMatch(/per wallet/);
    expect(log.refusal("0x3333333333333333333333333333333333333333", { perDay: 2, perWalletPerDay: 5 })).toMatch(/a day/);
    const b = log.board();
    expect(b.stats).toMatchObject({ attempts: 2, won: 0 });
    expect(b.attempts[0].wallet).toBe("0x2222…2222");
    expect(JSON.stringify(b)).not.toContain("INVOICE");
  });
});

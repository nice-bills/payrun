import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyInvariants, runChecks } from "../src/core/checks";
import { decide, MODES } from "../src/core/decide";
import { classifyGap } from "../src/core/gaps";
import { judgmentSystemPrompt, makePolicyVersion, parseClauses } from "../src/core/policy";
import { receiptsCsv } from "../src/core/receipts";
import { modelId, ServClient } from "../src/core/serv";
import { Store } from "../src/core/store";
import { compileWalletPolicy, toSettled, USDC_BASE_SEPOLIA } from "../src/core/walletPolicy";
import type { Contractor, Decision, InvoiceFields } from "../src/core/types";

const contractors: Contractor[] = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
const policy = makePolicyVersion(readFileSync("fixtures/policy.v1.md", "utf8"), 1);
const ama = contractors.find((c) => c.id === "ama")!;

const fields = (over: Partial<InvoiceFields> = {}): InvoiceFields => ({
  invoiceNumber: "INV-0412",
  contractorName: "Ama Mensah",
  contractorEmail: "ama@mensah.design",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  lines: [{ description: "UI design", quantity: 12, unit: "day", unitPriceUsdc: 350, amountUsdc: 4200 }],
  totalUsdc: 4200,
  payToWallet: ama.wallet,
  paymentChangeRequest: null,
  notes: null,
  ...over,
});

/** Fake SERV endpoint: records requests, answers from a queue. */
function fakeServ(answers: ((body: any) => any)[]) {
  const requests: { headers: Record<string, string>; body: any }[] = [];
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    requests.push({ headers: init.headers, body });
    const next = answers.shift();
    if (!next) throw new Error("unexpected SERV call");
    return new Response(JSON.stringify(next(body)), { status: 200 });
  }) as typeof fetch;
  return { serv: new ServClient({ apiKey: "test", traceDir: null, fetchImpl }), requests };
}
const completion = (content: unknown, finish = "stop") => () => ({
  choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finish }],
  usage: { prompt_tokens: 1000, completion_tokens: 200 },
});
/** Exact shape SERV returned for a Prompt Guard block in the spike. */
const guardRefusal = () => () => ({
  choices: [{ index: 0, message: { role: "assistant", content: null, refusal: "I can't share that." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
});
const rawFields = (f: InvoiceFields) => ({
  invoice_number: f.invoiceNumber, contractor_name: f.contractorName, contractor_email: f.contractorEmail,
  period_start: f.periodStart, period_end: f.periodEnd,
  lines: f.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unit_price_usdc: l.unitPriceUsdc, amount_usdc: l.amountUsdc })),
  total_usdc: f.totalUsdc, pay_to_wallet: f.payToWallet, payment_change_request: f.paymentChangeRequest, notes: f.notes,
});
const judgment = (verdict: string, over: object = {}) => ({
  verdict, cited_clauses: [1], reasons: [{ clause: 1, finding: "ok", evidence_quote: "12 days" }], policy_covers: true, suspected_manipulation: false, ...over,
});
const invoice = { id: "inv-1", source: "t.txt", rawText: "INVOICE", receivedAt: "2026-09-02" };

describe("policy", () => {
  it("parses numbered clauses and continuation lines", () => {
    expect(parseClauses("1. a\ncontinued\n2) b")).toEqual(["a continued", "b"]);
    expect(policy.clauses).toHaveLength(7);
  });
  it("hash is the SERV cache key: stable for the same clauses, different when a clause changes", () => {
    expect(makePolicyVersion(policy.text, 9).hash).toBe(policy.hash);
    expect(makePolicyVersion(policy.text + "\n8. New clause.", 2).hash).not.toBe(policy.hash);
    expect(judgmentSystemPrompt(policy.clauses)).not.toMatch(/Ama|INV-/);
  });
});

describe("checks and invariants", () => {
  it("clean invoice has no findings", () => {
    expect(runChecks(fields(), ama, [])).toEqual([]);
  });
  it("flags wallet swap, arithmetic, cap, rate", () => {
    const f = fields({
      payToWallet: "0x94e672298C44c94b0606740cBEfa6963fA3409C6",
      lines: [{ description: "x", quantity: 16, unit: "day", unitPriceUsdc: 400, amountUsdc: 6500 }],
      totalUsdc: 6500,
    });
    const codes = runChecks(f, ama, []).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["WALLET_MISMATCH", "ARITHMETIC_MISMATCH", "OVER_DAY_CAP", "RATE_MISMATCH"]));
  });
  it("a flat fee read as a fractional quantity is not an arithmetic error", () => {
    const flat = fields({ lines: [{ description: "Brand refresh", quantity: 0.5, unit: "item", unitPriceUsdc: 0.5, amountUsdc: 0.5 }], totalUsdc: 0.5 });
    expect(runChecks(flat, ama, []).map((x) => x.code)).not.toContain("ARITHMETIC_MISMATCH");
    const days = fields({ lines: [{ description: "Design", quantity: 2, unit: "day", unitPriceUsdc: 400, amountUsdc: 400 }], totalUsdc: 400 });
    expect(runChecks(days, ama, []).map((x) => x.code)).toContain("ARITHMETIC_MISMATCH");
  });
  it("exact duplicate ignores formatting; same period is a soft finding", () => {
    const hist = [{ invoiceId: "a", contractorId: "ama", invoiceNumber: "INV 412", periodStart: "2026-08-01", periodEnd: "2026-08-31", totalUsdc: 4200, verdict: "PAY" as const }];
    expect(runChecks(fields(), ama, hist).map((x) => x.code)).toEqual(["EXACT_DUPLICATE"]);
    const soft = runChecks(fields({ invoiceNumber: "INV-0413" }), ama, hist);
    expect(soft.map((x) => [x.code, x.hard])).toEqual([["SAME_PERIOD_ALREADY_BILLED", false]]);
  });
  it("a held invoice for the same period also makes a reissue a duplicate", () => {
    const hist = [{ invoiceId: "a", contractorId: "ama", invoiceNumber: "INV-0412", periodStart: "2026-08-01", periodEnd: "2026-08-31", totalUsdc: 4200, verdict: "HOLD" as const }];
    expect(runChecks(fields({ invoiceNumber: "INV-0413" }), ama, hist).map((x) => x.code)).toEqual(["SAME_PERIOD_ALREADY_BILLED"]);
    const blocked = [{ ...hist[0], verdict: "BLOCK" as const }];
    expect(runChecks(fields({ invoiceNumber: "INV-0413" }), ama, blocked)).toEqual([]);
  });
  it("states what passed, not only what failed", async () => {
    const { confirmedFacts } = await import("../src/core/checks.js");
    const f = confirmedFacts(fields(), ama, []);
    expect(f).toContain("Days billed: 12, within the 15-day monthly cap.");
    expect(f).toContain("Wallet on the invoice matches the wallet on file.");
    expect(f).toContain("No expense or fee lines.");
  });
  it("hard findings only ever make a verdict stricter", () => {
    const f = runChecks(fields({ payToWallet: "0x94e672298C44c94b0606740cBEfa6963fA3409C6" }), ama, []);
    expect(applyInvariants("PAY", f)).toEqual({ verdict: "HOLD", overriddenBy: ["WALLET_MISMATCH"] });
    expect(applyInvariants("BLOCK", f).verdict).toBe("BLOCK");
  });
});

describe("SERV client", () => {
  it("builds feature model ids and strips them in raw mode", () => {
    expect(modelId("gpt-5.4-nano", ["multipath", "kronos"])).toBe("gpt-5.4-nano-serv-kronos-multipath");
    expect(modelId("gpt-5.4-nano", ["kronos"], true)).toBe("gpt-5.4-nano");
  });
});

describe("decide", () => {
  it("SERV mode arms guard + shadow with a per-invoice hint and keeps the system prompt stable", async () => {
    const { serv, requests } = fakeServ([completion(rawFields(fields())), completion(judgment("PAY"))]);
    const d = await decide(serv, { invoice, policy, contractors, history: [], mode: MODES.serv });
    expect(d.finalVerdict).toBe("PAY");
    expect(d.payAmountUsdc).toBe(4200);
    const judge = requests[1].body;
    expect(judge.model).toBe(`${MODES.serv.model}-serv-kronos-multipath`);
    expect(judge.messages[0].content).toBe(judgmentSystemPrompt(policy.clauses));
    expect(requests[0].body.tools.map((t: any) => t.function.name)).toEqual(["serv_prompt_guard"]);
    expect(judge.tools.map((t: any) => t.function.name)).toEqual(["serv_shadow_agent"]);
    expect(judge.tools[0].function.parameters.properties.hint.default).toMatch(/clause numbers 1-7/);
    expect(requests[1].headers["x-openserv-disable-braid"]).toBeUndefined();
  });

  it("raw mode sends the bypass header and no SERV tools", async () => {
    const { serv, requests } = fakeServ([completion(rawFields(fields())), completion(judgment("PAY"))]);
    await decide(serv, { invoice, policy, contractors, history: [], mode: MODES.rawSmall });
    expect(requests.every((r) => r.headers["x-openserv-disable-braid"] === "true")).toBe(true);
    expect(requests.every((r) => !r.body.tools)).toBe(true);
  });

  it("a guard refusal on extraction blocks the invoice before any judgment", async () => {
    const { serv, requests } = fakeServ([guardRefusal()]);
    const d = await decide(serv, { invoice, policy, contractors, history: [], mode: MODES.serv });
    expect(d.finalVerdict).toBe("BLOCK");
    expect(d.blockedByGuard).toBe(true);
    expect(d.payAmountUsdc).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("a model PAY on a swapped wallet is overridden by code", async () => {
    const swapped = fields({ payToWallet: "0x94e672298C44c94b0606740cBEfa6963fA3409C6" });
    const { serv } = fakeServ([completion(rawFields(swapped)), completion(judgment("PAY"))]);
    const d = await decide(serv, { invoice, policy, contractors, history: [], mode: MODES.rawSmall });
    expect(d.judgment?.verdict).toBe("PAY");
    expect(d.finalVerdict).toBe("HOLD");
    expect(d.overriddenBy).toEqual(["WALLET_MISMATCH"]);
  });

  it("a model-side refusal (tokens billed) is not mistaken for a guard block", async () => {
    const modelRefusal = () => ({ choices: [{ message: { content: null, refusal: "no" }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 5 } });
    const { serv } = fakeServ([completion(rawFields(fields())), modelRefusal]);
    const d = await decide(serv, { invoice, policy, contractors, history: [], mode: MODES.serv });
    expect(d.blockedByGuard).toBe(false);
    expect(d.finalVerdict).toBe("HOLD");
  });

  it("retries a network failure", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(completion("ok")()), { status: 200 });
    }) as unknown as typeof fetch;
    const s = new ServClient({ apiKey: "t", traceDir: null, fetchImpl });
    expect((await s.call({ model: "gpt-5.4-nano", system: "s", user: "u", label: "x" })).content).toBe("ok");
  });

  it("an unparseable judgment is never a PAY; invalid clause numbers are dropped", async () => {
    const { serv } = fakeServ([completion(rawFields(fields())), completion("not json")]);
    expect((await decide(serv, { invoice, policy, contractors, history: [], mode: MODES.rawSmall })).finalVerdict).toBe("HOLD");
    const { serv: s2 } = fakeServ([completion(rawFields(fields())), completion(judgment("HOLD", { cited_clauses: [2, 99, 2] }))]);
    expect((await decide(s2, { invoice, policy, contractors, history: [], mode: MODES.rawSmall })).judgment?.citedClauses).toEqual([2]);
  });
});

describe("gap classification", () => {
  const d = (verdict: "PAY" | "HOLD", covers = true, cited = [1]) =>
    ({ finalVerdict: verdict, overriddenBy: [], blockedByGuard: false, judgment: { verdict, citedClauses: cited, reasons: [], policyCovers: covers, suspectedManipulation: false } }) as unknown as Decision;
  it("stable, covered, cited → no gap", () => expect(classifyGap([d("PAY"), d("PAY"), d("PAY")])).toEqual([]));
  it("detects flips, uncovered cases and uncited verdicts", () => {
    expect(classifyGap([d("PAY"), d("HOLD"), d("PAY", false, [])])).toEqual(["UNSTABLE", "NOT_COVERED", "NO_CLAUSE"]);
  });
  it("flags a silent choice: stable verdict, but the readings disagree", () => {
    const dd = (v: "PAY" | "HOLD") => ({ ...d(v), overriddenBy: [], blockedByGuard: false }) as unknown as Decision;
    const readings = [{ reading: "day 60 counts", verdict: "PAY" as const }, { reading: "day 60 is late", verdict: "BLOCK" as const }];
    expect(classifyGap([dd("PAY"), dd("PAY"), dd("PAY")], readings)).toEqual(["SILENT_CHOICE"]);
    expect(classifyGap([dd("PAY"), dd("PAY")], [{ reading: "a", verdict: "PAY" }, { reading: "b", verdict: "PAY" }])).toEqual([]);
    const forced = { ...dd("PAY"), overriddenBy: ["OVER_DAY_CAP"] } as unknown as Decision;
    expect(classifyGap([forced, forced], readings)).toEqual([]);
  });
});

describe("wallet policy", () => {
  it("allows USDC transfer only to each contractor, capped at their scaled agreement max", () => {
    const wp = compileWalletPolicy(contractors, policy, { scale: 0.001 });
    expect(wp.scope).toBe("account");
    expect(wp.rules).toHaveLength(contractors.length);
    expect(wp.description).toMatch(/^[A-Za-z0-9 ,.]{1,50}$/);
    const rule: any = wp.rules[0];
    expect(rule.criteria.find((c: any) => c.type === "evmAddress").addresses).toEqual([USDC_BASE_SEPOLIA]);
    const params = rule.criteria.find((c: any) => c.type === "evmData").conditions[0].params;
    expect(params[0].values).toEqual([ama.wallet]);
    expect(params[1].value).toBe(String(toSettled(350 * 15, 0.001) * 1e6)); // 5.25 USDC → 5250000
  });
  it("stays within CDP's 10-rule limit for large address books", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...ama, id: `c${i}`, wallet: `0x${String(i).padStart(40, "0")}` as `0x${string}`, dayRateUsdc: 100 + i }));
    const wp = compileWalletPolicy(many, policy, { scale: 0.001 });
    expect(wp.rules).toHaveLength(1);
    const params = (wp.rules[0] as any).criteria[2].conditions[0].params;
    expect(params[0].values).toHaveLength(14);
    expect(params[1].value).toBe(String(Math.round(113 * 15 * 0.001 * 1e6)));
  });
  it("adds one uncapped withdraw rule for the owner, and only for the owner", () => {
    const owner = "0x069c000000000000000000000000000000004032";
    const wp = compileWalletPolicy(contractors, policy, { scale: 0.001, owner });
    expect(wp.rules).toHaveLength(contractors.length + 1);
    const params = (wp.rules.at(-1) as any).criteria[2].conditions[0].params;
    expect(params).toEqual([{ name: "to", operator: "in", values: [owner] }]);
    // Ten contractors plus an owner would be 11 rules: contractors collapse, the owner rule stays.
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...ama, id: `c${i}`, wallet: `0x${String(i).padStart(40, "0")}` as `0x${string}` }));
    expect(compileWalletPolicy(ten, policy, { scale: 0.001, owner }).rules).toHaveLength(2);
    expect(() => compileWalletPolicy(contractors, policy, { owner: ama.wallet })).toThrow(/contractor/);
  });
});

describe("store + receipts", () => {
  it("versions policies, dedupes identical text, and exports receipts", () => {
    const s = new Store(":memory:");
    const v1 = s.addPolicy(policy.text);
    expect(s.addPolicy(policy.text).version).toBe(v1.version);
    expect(s.addPolicy(policy.text + "\n8. x").version).toBe(2);
    const dec: Decision = {
      invoiceId: "inv-1", policyVersion: 1, policyHash: v1.hash, fields: fields(), contractorId: "ama", findings: [],
      judgment: { verdict: "PAY", citedClauses: [1], reasons: [{ clause: 1, finding: "rate matches", evidenceQuote: "350" }], policyCovers: true, suspectedManipulation: false },
      finalVerdict: "PAY", payAmountUsdc: 4200, overriddenBy: [], blockedByGuard: false, calls: [], decidedAt: "x",
    };
    s.addDecision(dec, "serv");
    expect(s.history()).toHaveLength(1);
    expect(s.history("inv-0")).toHaveLength(0); // arrived before inv-1: inv-1 is not its history
    expect(s.history("inv-2")).toHaveLength(1);
    const csv = receiptsCsv(s.latestDecisions(), [{ invoiceId: "inv-1", contractorId: "ama", to: ama.wallet, amountUsdc: 4200, settledUsdc: 4.2, status: "sent", txHash: "0x" + "a".repeat(64), message: "", sentAt: "" }], contractors);
    expect(csv).toContain("sepolia.basescan.org/tx/0xaaaa");
    expect(csv.split("\n")[1]).toContain("PAY,1,");
  });
});

describe("facts, cassette, variants", () => {
  it("computes receipt timing in code", async () => {
    const { receivedFact } = await import("../src/core/decide.js");
    expect(receivedFact("2026-09-05T09:00:00Z", "2026-08-31")).toBe("Received 2026-09-05, 5 days after the billing period ended (2026-08-31).");
    expect(receivedFact("2026-09-05", null)).toMatch(/states no billing period end/);
  });

  it("puts written expense approvals in FACTS, 'none' when absent", async () => {
    const { judgmentUserMessage } = await import("../src/core/decide.js");
    const esi = contractors.find((c) => c.id === "esi")!;
    expect(judgmentUserMessage(invoice, fields(), esi, [])).toMatch(/approvals on file for this contractor: Figma seat/);
    expect(judgmentUserMessage(invoice, fields(), ama, [])).toMatch(/approvals on file for this contractor: none/);
  });

  it("records once, then replays without calling SERV; variants are recorded separately", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/cassette-`);
    let live = 0;
    const fetchImpl = (async () => {
      live++;
      return new Response(JSON.stringify(completion(`answer ${live}`)()), { status: 200 });
    }) as unknown as typeof fetch;
    const rec = new ServClient({ apiKey: "t", traceDir: null, fetchImpl, cassetteMode: "auto", cassetteDir: dir });
    const call = { model: "gpt-5.4-nano", system: "s", user: "u", label: "x" };
    expect((await rec.call(call)).content).toBe("answer 1");
    expect((await rec.call(call)).content).toBe("answer 1");
    expect((await rec.call({ ...call, variant: "run-2" })).content).toBe("answer 2");
    expect(live).toBe(2);
    const replay = new ServClient({ apiKey: "", traceDir: null, fetchImpl, cassetteMode: "replay", cassetteDir: dir });
    const r = await replay.call(call);
    expect(r.content).toBe("answer 1");
    expect(r.meta.replayed).toBe(true);
    await expect(replay.call({ ...call, user: "never recorded" })).rejects.toThrow(/No recorded SERV response/);
  });

  it("policy v2 is a new version with a new SERV cache key", () => {
    const v2 = makePolicyVersion(readFileSync("fixtures/policy.v2.md", "utf8"), 2);
    expect(v2.clauses).toHaveLength(8);
    expect(v2.hash).not.toBe(policy.hash);
  });
});

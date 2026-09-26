import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentSystemPrompt } from "../src/core/agent";
import { makePolicyVersion, judgmentSystemPrompt } from "../src/core/policy";
import { warmPolicy } from "../src/core/warm";
import { say, scriptedServ } from "../scripts/demo/kit";

describe("warming SERV's graphs on going live", () => {
  it("sends one request per graph, with exactly the system prompts and models the real calls use", async () => {
    const policy = makePolicyVersion(readFileSync("fixtures/policy.v1.md", "utf8"), 1);
    const { serv, seen } = scriptedServ([say.content({ verdict: "HOLD" }), say.call("hold_invoice", {})]);
    const r = await warmPolicy(serv, policy);
    expect(seen.map((b) => b.messages[0].content)).toEqual([judgmentSystemPrompt(policy.clauses), agentSystemPrompt(policy.clauses)]);
    expect(seen.every((b) => b.model.endsWith("-serv-kronos-multipath"))).toBe(true);
    expect(seen[1].tools.map((t: any) => t.function.name)).toContain("pay_invoice");
    expect(r.graphs.map((g) => g.name)).toEqual(["review", "agent"]);
    expect(r.graphs.every((g) => g.requestId?.startsWith("req_demo_"))).toBe(true);
    expect(r).toMatchObject({ version: 1, hash: policy.hash });
  });
});

import { agentSystemPrompt, AGENT_TOOLS } from "./agent";
import { JUDGMENT_SCHEMA, MODES } from "./decide";
import { judgmentSystemPrompt } from "./policy";
import type { ServClient } from "./serv";
import type { PolicyVersion } from "./types";

/**
 * SERV compiles a reasoning graph the first time it sees a system prompt (Kronos
 * audit + Multipath, about a minute) and caches it per org for 30 days. A policy
 * version has two: the desk's review prompt and the pay-run agent's prompt. Going
 * live sends one small request for each, shaped like the real call (same model,
 * features, schema or tools), so the compile happens now and the first real invoice
 * under the new wording is answered in seconds.
 */
export { warmKey, type WarmGraph, type WarmReport } from "./warmStatus";
import type { WarmGraph, WarmReport } from "./warmStatus";

/** Below this, SERV answered from a graph it already had. */
const CACHED_MS = 15_000;

export async function warmPolicy(serv: ServClient, policy: PolicyVersion, log: (msg: string) => void = () => {}, cachedBelowMs = CACHED_MS): Promise<WarmReport> {
  const user = "Warm-up request from Payrun: no invoice. Answer as briefly as the format allows.";
  const graphs: WarmGraph[] = [];
  const calls = [
    {
      name: "review" as const,
      run: () =>
        serv.call({
          model: MODES.serv.model,
          features: MODES.serv.features,
          reasoningEffort: MODES.serv.reasoningEffort,
          system: judgmentSystemPrompt(policy.clauses),
          user,
          schema: { name: "payment_judgment", schema: JUDGMENT_SCHEMA },
          maxCompletionTokens: 200,
          label: `warm-review-v${policy.version}`,
        }),
    },
    {
      name: "agent" as const,
      run: () =>
        serv.call({
          model: MODES.serv.model,
          features: MODES.serv.features,
          reasoningEffort: "none",
          system: agentSystemPrompt(policy.clauses),
          user,
          appTools: AGENT_TOOLS,
          toolChoice: "required",
          maxCompletionTokens: 200,
          label: `warm-agent-v${policy.version}`,
        }),
    },
  ];
  for (const c of calls) {
    log(`SERV is compiling the ${c.name === "review" ? "desk review" : "pay-run agent"} graph for v${policy.version}…`);
    const started = Date.now();
    const res = await c.run();
    const ms = res.meta.replayed ? res.meta.latencyMs : Date.now() - started;
    const g = { name: c.name, ms, requestId: res.meta.requestId ?? null, cached: ms < cachedBelowMs };
    graphs.push(g);
    log(`${c.name === "review" ? "Desk review" : "Pay-run agent"} graph ${g.cached ? "was already compiled" : "compiled"} (${(ms / 1000).toFixed(1)}s).`);
  }
  return { version: policy.version, hash: policy.hash, graphs, at: new Date().toISOString() };
}

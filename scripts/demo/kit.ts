/**
 * Offline stand-ins for the feature demos, so each one runs with no keys and no
 * credit: a scripted SERV (answers in order, same wire shapes SERV returns), a
 * wallet that records transfers, and an in-memory Redis that speaks Upstash's
 * REST protocol. Each demo prints what the real pipeline does; run the same
 * command with keys (`--live`) to do it for real.
 */
import { createServer, type Server } from "node:http";
import type { AgentWallet } from "../../src/core/agent";
import { ServClient } from "../../src/core/serv";

const usage = { prompt_tokens: 900, completion_tokens: 120 };
let reqN = 0;
const headers = () => ({ "content-type": "application/json", "x-openserv-request-id": `req_demo_${(++reqN).toString().padStart(4, "0")}` });

export const say = {
  content: (c: unknown) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(c) }, finish_reason: "stop" }], usage }),
  call: (name: string, args: object) => ({
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `call_${name}_${reqN}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
    usage,
  }),
  /** Prompt Guard's refusal: the model never ran, zero tokens. */
  guardRefusal: () => ({ choices: [{ message: { role: "assistant", content: null, refusal: "I can't help with that." }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0 } }),
};

/** A SERV client whose answers are scripted. `seen` holds every request body, for showing what was sent. */
export function scriptedServ(answers: unknown[]) {
  const seen: any[] = [];
  const fetchImpl = (async (_u: string, init: any) => {
    seen.push(JSON.parse(init.body));
    const next = answers.shift();
    if (!next) throw new Error("the demo script ran out of SERV answers");
    return new Response(JSON.stringify(next), { status: 200, headers: headers() });
  }) as typeof fetch;
  return { serv: new ServClient({ apiKey: "demo", traceDir: null, fetchImpl, cassetteMode: "off" }), seen };
}

export function recordingWallet(address = "0x1BFB000000000000000000000000000000004e24", usdc = 20): AgentWallet & { sent: { to: string; amount: number }[] } {
  const sent: { to: string; amount: number }[] = [];
  return {
    address,
    sent,
    balance: async () => ({ usdc, message: `Balance of USDC at address ${address} is ${usdc}` }),
    transfer: async (to, amount) => {
      sent.push({ to, amount });
      return { ok: true, txHash: `0x${"d".repeat(64)}`, message: "Transferred" };
    },
  };
}

/** An in-memory Redis behind Upstash's REST protocol (POST a JSON command array, get {result}). */
export async function fakeUpstash(port = 0): Promise<{ url: string; token: string; lists: Map<string, string[]>; close: () => Promise<void> }> {
  const lists = new Map<string, string[]>();
  const token = "demo-token";
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const send = (code: number, j: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(j));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
      const [cmd, key, ...rest] = JSON.parse(body) as string[];
      const list = lists.get(key) ?? [];
      if (cmd === "RPUSH") {
        list.push(...rest);
        lists.set(key, list);
        return send(200, { result: list.length });
      }
      if (cmd === "LRANGE") return send(200, { result: list });
      if (cmd === "DEL") return send(200, { result: lists.delete(key) ? 1 : 0 });
      send(400, { error: `unsupported ${cmd}` });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, token, lists, close: () => new Promise((r) => server.close(() => r())) };
}

export const line = (s = "") => console.log(s);
export const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
export const step = (s: { actor: string; ok: boolean | null; title: string; detail: string }) =>
  console.log(`  ${s.actor.padEnd(8)} ${s.ok === false ? "✗" : s.ok ? "✓" : "·"} ${s.title} — ${s.detail.slice(0, 140)}`);

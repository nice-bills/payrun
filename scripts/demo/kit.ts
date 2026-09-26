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

/**
 * A stand-in for an OpenServ x402 trigger: answers 402 with its price (x402 v1,
 * as OpenServ advertises it), checks the EIP-3009 payment signature for real,
 * then runs `work(payload)` and replies with its result.
 */
export async function fakeX402Trigger(opts: {
  priceUsdc: number;
  payTo: string;
  network?: "base" | "base-sepolia";
  work: (payload: any) => Promise<unknown>;
}): Promise<{ url: string; paid: { from: string; value: string; to: string; verified: boolean }[]; close: () => Promise<void> }> {
  const { verifyTypedData } = await import("viem");
  const network = opts.network ?? "base";
  const chainId = network === "base" ? 8453 : 84532;
  const asset = network === "base" ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const paid: { from: string; value: string; to: string; verified: boolean }[] = [];
  let url = "";
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const header = req.headers["x-payment"] ?? req.headers["payment-signature"];
      const requirement = {
        scheme: "exact", network, maxAmountRequired: String(Math.round(opts.priceUsdc * 1e6)), resource: url,
        description: "Payrun Check", mimeType: "application/json", payTo: opts.payTo, maxTimeoutSeconds: 600, asset,
        extra: { name: "USD Coin", version: "2" },
      };
      if (!header) {
        res.writeHead(402, { "content-type": "application/json" });
        return res.end(JSON.stringify({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [requirement] }));
      }
      const p = JSON.parse(Buffer.from(String(header), "base64").toString());
      const auth = p.payload.authorization;
      const verified = await verifyTypedData({
        address: auth.from,
        domain: { name: "USD Coin", version: "2", chainId, verifyingContract: asset as `0x${string}` },
        types: { TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ] },
        primaryType: "TransferWithAuthorization",
        message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) },
        signature: p.payload.signature,
      });
      paid.push({ from: auth.from, value: auth.value, to: auth.to, verified });
      if (!verified || BigInt(auth.value) < BigInt(requirement.maxAmountRequired) || auth.to.toLowerCase() !== opts.payTo.toLowerCase()) {
        res.writeHead(402, { "content-type": "application/json" });
        return res.end(JSON.stringify({ x402Version: 1, error: "invalid payment", accepts: [requirement] }));
      }
      const { payload } = JSON.parse(body);
      const result = await opts.work(payload);
      const settle = Buffer.from(JSON.stringify({ success: true, transaction: `0x${"e".repeat(64)}`, network, payer: auth.from })).toString("base64");
      res.writeHead(200, { "content-type": "application/json", "x-payment-response": settle, "access-control-expose-headers": "X-PAYMENT-RESPONSE" });
      // OpenServ returns the workflow's output; the agent's reply is the check JSON as text.
      res.end(JSON.stringify({ status: "completed", output: JSON.stringify(result, null, 2) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/webhooks/x402/trigger/demo`;
  return { url, paid, close: () => new Promise((r) => server.close(() => r())) };
}

/** AgentKit 0.10.4 fires usage analytics without awaiting them; offline, the rejection would kill the demo. */
export function quietAgentKit() {
  process.on("unhandledRejection", (reason) => {
    if (reason instanceof Error && reason.stack?.includes("sendAnalyticsEvent")) return;
    throw reason;
  });
}

/** A throwaway local-key AgentKit wallet on Base (signs x402 payments offline; never sends a transaction). */
export async function localWallet() {
  const { ViemWalletProvider } = await import("@coinbase/agentkit");
  const { createWalletClient, http } = await import("viem");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const { base } = await import("viem/chains");
  // AgentKit bundles its own viem; the client is the same at runtime, only the declarations differ.
  return new ViemWalletProvider(createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: base, transport: http("http://127.0.0.1:1") }) as never);
}

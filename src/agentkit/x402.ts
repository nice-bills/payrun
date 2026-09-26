/**
 * Paying an OpenServ x402 trigger from an AgentKit wallet. AgentKit's own x402
 * provider signs with the wallet provider's signer through @x402/fetch; this
 * does the same with a payment policy in front, so nothing outside it is signed.
 */
import type { EvmWalletProvider } from "@coinbase/agentkit";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

/** USDC on Base and Base Sepolia: the only assets the check is paid in. */
const USDC: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  // x402 v1 names, as OpenServ's triggers advertise them
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/** Only USDC on Base, within the price cap, to the expected payee. Anything else is never signed. */
export function paymentFilter(maxPriceUsdc: number, payTo?: string) {
  const max = BigInt(Math.round(maxPriceUsdc * 1e6));
  return (_v: number, reqs: { network: string; asset: string; amount?: string; maxAmountRequired?: string; payTo: string }[]) =>
    reqs.filter((r) => {
      const usdc = USDC[r.network];
      const amount = r.amount ?? r.maxAmountRequired;
      return (
        !!usdc &&
        r.asset.toLowerCase() === usdc.toLowerCase() &&
        amount !== undefined &&
        BigInt(amount) <= max &&
        (!payTo || r.payTo.toLowerCase() === payTo.toLowerCase())
      );
    });
}

/** The workflow's reply wraps the check's JSON; find the verdict wherever it sits. */
export function findVerdict(data: unknown): Verdictish | null {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (o.verdict === "PAY" || o.verdict === "HOLD" || o.verdict === "BLOCK") return o as Verdictish;
    for (const v of Object.values(o)) {
      const found = findVerdict(v);
      if (found) return found;
    }
  }
  if (typeof data === "string") {
    const start = data.indexOf("{");
    const end = data.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return findVerdict(JSON.parse(data.slice(start, end + 1)));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export type Verdictish = { verdict: "PAY" | "HOLD" | "BLOCK"; [k: string]: unknown };

/** The x402 client's refusal when every payment option failed the policy. */
export const isPriceRefusal = (msg: string) => /filtered out by policies|rejected by spendControls/.test(msg);

export interface X402PostOptions {
  maxPriceUsdc: number;
  payTo?: string;
  fetchImpl?: typeof fetch;
}

/** POST a payload to an OpenServ x402 trigger, paying from the AgentKit wallet within the policy. */
export async function x402Post(walletProvider: EvmWalletProvider, url: string, payload: unknown, opts: X402PostOptions) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: walletProvider.toSigner() });
  client.registerPolicy(paymentFilter(opts.maxPriceUsdc, opts.payTo) as never);
  const pay = wrapFetchWithPayment(opts.fetchImpl ?? fetch, client);
  const res = await pay(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buyerAddress: walletProvider.getAddress(), payload }),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // plain text reply
  }
  const proof = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  let payment: unknown = null;
  if (proof) {
    try {
      payment = JSON.parse(atob(proof));
    } catch {
      payment = { raw: proof };
    }
  }
  return { ok: res.ok, status: res.status, data, payment };
}

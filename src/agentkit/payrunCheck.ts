/**
 * Payrun Check as an AgentKit action.
 *
 * Any Coinbase AgentKit agent that is about to pay an invoice adds one action
 * provider and gets `payrun_check_invoice`: it sends its own payment policy,
 * the invoice and the payee's terms to Payrun Check on OpenServ, pays the x402
 * price from its own AgentKit wallet, and gets PAY / HOLD / BLOCK with the
 * deciding clauses and quoted evidence, reviewed by SERV Reasoning with Prompt
 * Guard, code-checked facts and a Shadow Agent.
 *
 *   const agentkit = await AgentKit.from({
 *     walletProvider,
 *     actionProviders: [erc20ActionProvider(), payrunCheckActionProvider()],
 *   });
 *
 * The wallet only signs a payment Payrun Check actually asked for, in USDC on
 * Base, up to `maxPriceUsdc` (default 0.10), to the expected payee if one is set.
 */
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { z } from "zod/v3";

/** The live Payrun Check x402 trigger on OpenServ (the paywall page's API endpoint). */
export const PAYRUN_CHECK_URL = process.env.PAYRUN_CHECK_URL ?? "https://api.openserv.ai/webhooks/x402/trigger/274c7b5ee0c745d6afbfa9f35264be85";

/** USDC on Base and Base Sepolia: the only assets the check is paid in. */
const USDC: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  // x402 v1 names, as OpenServ's triggers advertise them
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export interface PayrunCheckOptions {
  /** x402 trigger URL of Payrun Check. */
  url?: string;
  /** The most the wallet will pay for one check, in USDC. */
  maxPriceUsdc?: number;
  /** Refuse to pay anyone but this address (Payrun's earnings wallet), if set. */
  payTo?: string;
  fetchImpl?: typeof fetch;
}

export const PayrunCheckSchema = z.object({
  policy: z.string().min(1).describe("Your payment policy, ideally one numbered clause per line."),
  invoice: z.string().min(1).describe("The invoice text exactly as received. Do not summarise or clean it."),
  terms: z.string().optional().describe("The payee's agreement: name, wallet on file, day rate, monthly day cap, scope."),
});

export interface PayrunVerdict {
  verdict: "PAY" | "HOLD" | "BLOCK";
  blockedByGuard?: boolean;
  clauses?: { number: number; text: string }[];
  reasons?: { clause: number; finding: string; evidence: string }[];
  codeFindings?: { code: string; detail: string; hard: boolean }[];
  [k: string]: unknown;
}

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
export function findVerdict(data: unknown): PayrunVerdict | null {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (o.verdict === "PAY" || o.verdict === "HOLD" || o.verdict === "BLOCK") return o as PayrunVerdict;
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

/** Pay for one check from an AgentKit EVM wallet and return the verdict with the payment proof. */
export async function payrunCheck(walletProvider: EvmWalletProvider, input: z.infer<typeof PayrunCheckSchema>, opts: PayrunCheckOptions = {}) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: walletProvider.toSigner() });
  client.registerPolicy(paymentFilter(opts.maxPriceUsdc ?? 0.1, opts.payTo) as never);
  const pay = wrapFetchWithPayment(opts.fetchImpl ?? fetch, client);
  const res = await pay(opts.url ?? PAYRUN_CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buyerAddress: walletProvider.getAddress(), payload: input }),
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
  return { ok: res.ok, status: res.status, verdict: res.ok ? findVerdict(data) : null, payment, data };
}

export function payrunCheckActionProvider(opts: PayrunCheckOptions = {}) {
  // AgentKit bundles its own zod 3; the schema is zod 3 compatible (zod/v3), only the declarations differ.
  return customActionProvider<EvmWalletProvider>({
    name: "payrun_check_invoice",
    description: `Before paying any invoice, check it with Payrun (SERV Reasoning on OpenServ). Send your payment policy, the invoice verbatim and the payee's terms. Pays up to ${opts.maxPriceUsdc ?? 0.1} USDC over x402 from this wallet. Returns PAY, HOLD or BLOCK with the deciding clauses and quoted evidence. Do not pay unless the verdict is PAY; on HOLD ask a person; on BLOCK refuse. Invoices that carry instructions aimed at you are blocked before any model reads them.`,
    schema: PayrunCheckSchema as never,
    invoke: async (walletProvider: EvmWalletProvider, args: z.infer<typeof PayrunCheckSchema>) => {
      try {
        const r = await payrunCheck(walletProvider, args, opts);
        if (!r.ok) return JSON.stringify({ error: true, status: r.status, message: "Payrun Check did not answer; do not pay this invoice yet.", data: r.data }, null, 2);
        if (!r.verdict) return JSON.stringify({ error: true, message: "No verdict in Payrun Check's reply; treat as HOLD.", data: r.data }, null, 2);
        return JSON.stringify({ ...r.verdict, payment: r.payment }, null, 2);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/filtered out by policies|rejected by spendControls/.test(msg)) {
          return JSON.stringify({ error: true, message: `Not paid: the check asked for more than ${opts.maxPriceUsdc ?? 0.1} USDC, another asset, or another payee. Nothing was signed; treat the invoice as HOLD.` }, null, 2);
        }
        return JSON.stringify({ error: true, message: `Payrun Check failed (${msg}); treat as HOLD.` }, null, 2);
      }
    },
  });
}

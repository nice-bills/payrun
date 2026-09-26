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
import { z } from "zod/v3";
import { findVerdict, isPriceRefusal, x402Post } from "./x402";

export { findVerdict, paymentFilter } from "./x402";

/** The live Payrun Check x402 trigger on OpenServ (the paywall page's API endpoint). */
export const PAYRUN_CHECK_URL = process.env.PAYRUN_CHECK_URL ?? "https://api.openserv.ai/webhooks/x402/trigger/274c7b5ee0c745d6afbfa9f35264be85";

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

/** Pay for one check from an AgentKit EVM wallet and return the verdict with the payment proof. */
export async function payrunCheck(walletProvider: EvmWalletProvider, input: z.infer<typeof PayrunCheckSchema>, opts: PayrunCheckOptions = {}) {
  const r = await x402Post(walletProvider, opts.url ?? PAYRUN_CHECK_URL, input, { maxPriceUsdc: opts.maxPriceUsdc ?? 0.1, payTo: opts.payTo, fetchImpl: opts.fetchImpl });
  return { ...r, verdict: r.ok ? (findVerdict(r.data) as PayrunVerdict | null) : null };
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
        if (isPriceRefusal(msg)) {
          return JSON.stringify({ error: true, message: `Not paid: the check asked for more than ${opts.maxPriceUsdc ?? 0.1} USDC, another asset, or another payee. Nothing was signed; treat the invoice as HOLD.` }, null, 2);
        }
        return JSON.stringify({ error: true, message: `Payrun Check failed (${msg}); treat as HOLD.` }, null, 2);
      }
    },
  });
}

import { AgentKit, CdpEvmWalletProvider, erc20ActionProvider } from "@coinbase/agentkit";
import { compileWalletPolicy, toSettled, USDC_BASE_SEPOLIA } from "./walletPolicy.js";
import type { Contractor, Decision, PolicyVersion } from "./types.js";

// AgentKit 0.10.4 fires usage analytics without awaiting them; when the
// analytics endpoint answers 400 the rejection is unhandled and kills Node.
// Swallow exactly that rejection and nothing else.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && reason.stack?.includes("sendAnalyticsEvent")) return;
  throw reason;
});

export interface PaymentResult {
  invoiceId: string;
  contractorId: string;
  to: string;
  /** Invoice amount approved. */
  amountUsdc: number;
  /** Amount actually moved onchain (testnet settlement scale applied). */
  settledUsdc: number;
  status: "sent" | "rejected" | "failed";
  txHash: string | null;
  message: string;
  sentAt: string;
}

export interface Payer {
  address: string;
  /** Apply the compiled CDP policy to the paying account. Returns the policy id. */
  applyPolicy(policy: PolicyVersion, contractors: Contractor[]): Promise<string>;
  transfer(to: string, amountUsdc: number): Promise<{ ok: boolean; txHash: string | null; message: string }>;
  fundFromFaucet(): Promise<string[]>;
}

/**
 * AgentKit-backed payer. Transfers go through AgentKit's ERC20 `transfer` action
 * on a CDP server wallet, so the CDP account policy is the last gate: a transfer
 * outside the address book or above the agreement cap is refused by the signer.
 */
export async function createAgentKitPayer(): Promise<Payer> {
  const walletProvider = await CdpEvmWalletProvider.configureWithWallet({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
    networkId: "base-sepolia",
    address: (process.env.PAYRUN_WALLET_ADDRESS as `0x${string}`) || undefined,
    idempotencyKey: process.env.PAYRUN_WALLET_ADDRESS ? undefined : "payrun-demo-payer-v1",
  });
  const agentkit = await AgentKit.from({ walletProvider, actionProviders: [erc20ActionProvider()] });
  const transferAction = agentkit.getActions().find((a) => a.name.endsWith("_transfer"));
  if (!transferAction) throw new Error("AgentKit ERC20 transfer action not found");
  const cdp = walletProvider.getClient();
  const address = walletProvider.getAddress();

  return {
    address,
    async applyPolicy(policy, contractors) {
      const created = await cdp.policies.createPolicy({ policy: compileWalletPolicy(contractors, policy) });
      await cdp.evm.updateAccount({ address: address as `0x${string}`, update: { accountPolicy: created.id } });
      return created.id;
    },
    async transfer(to, amountUsdc) {
      const message = await transferAction.invoke({
        amount: String(amountUsdc),
        tokenAddress: USDC_BASE_SEPOLIA,
        destinationAddress: to,
      });
      const hash = /0x[0-9a-fA-F]{64}/.exec(message)?.[0] ?? null;
      return { ok: !message.startsWith("Error") && !!hash, txHash: hash, message };
    },
    async fundFromFaucet() {
      const hashes: string[] = [];
      for (const token of ["eth", "usdc"] as const) {
        const r = await cdp.evm.requestFaucet({ address, network: "base-sepolia", token });
        hashes.push(r.transactionHash);
      }
      return hashes;
    },
  };
}

/** Policy rejections from the CDP signer surface as errors mentioning the policy. */
export function isPolicyRejection(message: string): boolean {
  return /polic(y|ies)|rejected by|not allowed|forbidden/i.test(message);
}

/**
 * Pay every PAY decision. Payments always go to the wallet on file, never to an
 * address taken from the invoice.
 */
export async function payApproved(payer: Payer, decisions: Decision[], contractors: Contractor[]): Promise<PaymentResult[]> {
  const out: PaymentResult[] = [];
  for (const d of decisions) {
    if (d.finalVerdict !== "PAY" || !d.contractorId) continue;
    const c = contractors.find((x) => x.id === d.contractorId);
    if (!c) continue;
    const settledUsdc = toSettled(d.payAmountUsdc);
    const r = await payer.transfer(c.wallet, settledUsdc);
    out.push({
      invoiceId: d.invoiceId,
      contractorId: c.id,
      to: c.wallet,
      amountUsdc: d.payAmountUsdc,
      settledUsdc,
      status: r.ok ? "sent" : isPolicyRejection(r.message) ? "rejected" : "failed",
      txHash: r.txHash,
      message: r.message,
      sentAt: new Date().toISOString(),
    });
  }
  return out;
}

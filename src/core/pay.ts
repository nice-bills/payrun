import { AgentKit, CdpEvmWalletProvider, erc20ActionProvider } from "@coinbase/agentkit";
import type { CreatePolicyBody } from "@coinbase/cdp-sdk";
import { compileWalletPolicy, toSettled, USDC_BASE_SEPOLIA } from "./walletPolicy";
import type { Contractor, Decision, PolicyVersion } from "./types";

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
  /** queued: in a pay run's batch, not yet settled (a later row records the outcome). */
  status: "sent" | "rejected" | "failed" | "queued";
  txHash: string | null;
  message: string;
  sentAt: string;
}

export interface Payer {
  address: string;
  /** Apply the compiled CDP policy to the paying account (with the owner's withdraw rule, if set). Returns the policy id. */
  applyPolicy(policy: PolicyVersion, contractors: Contractor[], owner?: string | null): Promise<string>;
  /** Attach an already-compiled CDP policy body. */
  applyRules(body: CreatePolicyBody): Promise<string>;
  transfer(to: string, amountUsdc: number): Promise<{ ok: boolean; txHash: string | null; message: string }>;
  /** USDC held by the paying account, read through AgentKit's own get_balance action. */
  balance(): Promise<{ usdc: number | null; message: string }>;
  /** Policy ids currently attached to the paying account. */
  attachedPolicies(): Promise<string[]>;
  fundFromFaucet(): Promise<string[]>;
}

/**
 * AgentKit-backed payer. Transfers go through AgentKit's ERC20 `transfer` action
 * on a CDP server wallet, so the CDP account policy is the last gate: a transfer
 * outside the address book or above the agreement cap is refused by the signer.
 */
export interface PayerOptions {
  /** An existing CDP account to drive. Defaults to PAYRUN_WALLET_ADDRESS. */
  address?: string;
  /** Creates (or finds) the account by this key when no address is given. */
  idempotencyKey?: string;
}

export async function createAgentKitPayer(opts: PayerOptions = {}): Promise<Payer> {
  const address = opts.address ?? (opts.idempotencyKey ? undefined : process.env.PAYRUN_WALLET_ADDRESS);
  const walletProvider = await CdpEvmWalletProvider.configureWithWallet({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
    networkId: "base-sepolia",
    address: (address as `0x${string}`) || undefined,
    idempotencyKey: address ? undefined : (opts.idempotencyKey ?? "payrun-demo-payer-v1"),
  });
  const agentkit = await AgentKit.from({ walletProvider, actionProviders: [erc20ActionProvider()] });
  const transferAction = agentkit.getActions().find((a) => a.name.endsWith("_transfer"));
  const balanceAction = agentkit.getActions().find((a) => a.name.endsWith("_get_balance"));
  if (!transferAction || !balanceAction) throw new Error("AgentKit ERC20 transfer/get_balance actions not found");
  const cdp = walletProvider.getClient();
  const account = walletProvider.getAddress();

  return {
    address: account,
    async applyRules(body) {
      const created = await cdp.policies.createPolicy({ policy: body });
      await cdp.evm.updateAccount({ address: account as `0x${string}`, update: { accountPolicy: created.id } });
      return created.id;
    },
    async applyPolicy(policy, contractors, owner) {
      const created = await cdp.policies.createPolicy({ policy: compileWalletPolicy(contractors, policy, { owner }) });
      await cdp.evm.updateAccount({ address: account as `0x${string}`, update: { accountPolicy: created.id } });
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
    async balance() {
      const message = await balanceAction.invoke({ tokenAddress: USDC_BASE_SEPOLIA });
      const n = /is ([0-9.]+)\s*$/.exec(message.trim())?.[1];
      return { usdc: n === undefined ? null : Number(n), message };
    },
    async attachedPolicies() {
      const acct = await cdp.evm.getAccount({ address: account as `0x${string}` });
      return acct.policies ?? [];
    },
    async fundFromFaucet() {
      const hashes: string[] = [];
      for (const token of ["eth", "usdc"] as const) {
        const r = await cdp.evm.requestFaucet({ address: account, network: "base-sepolia", token });
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

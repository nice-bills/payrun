import { AgentKit, CdpSmartWalletProvider, erc20ActionProvider } from "@coinbase/agentkit";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import type { BatchResult, BatchSender, BatchTransfer } from "./batch";
import type { Contractor, PolicyVersion } from "./types";
import { compileWalletPolicy, USDC_BASE_SEPOLIA, USDC_DECIMALS } from "./walletPolicy";

/**
 * The smart payroll wallet (opt-in: PAYRUN_WALLET_KIND=smart). A CDP smart account
 * driven through AgentKit's CdpSmartWalletProvider, owned by a CDP server account.
 * A pay run's payouts settle together in one user operation, gas sponsored on
 * Base Sepolia, so the payroll wallet needs no ETH.
 *
 * The owner account signs every user operation, so the compiled wallet rules are
 * attached to it as `sendUserOperation` rules: each call in a batch must be a USDC
 * `transfer` to a contractor-book wallet within that agreement's cap.
 */
export interface SmartPayer extends BatchSender {
  ownerAddress: string;
  applyPolicy(policy: PolicyVersion, contractors: Contractor[], owner?: string | null): Promise<string>;
  /** One transfer as its own user operation (used to show the signer refusing an outside address). */
  transfer(to: string, amountUsdc: number): Promise<{ ok: boolean; txHash: string | null; message: string }>;
}

export const transferCall = (t: BatchTransfer) => ({
  to: USDC_BASE_SEPOLIA as `0x${string}`,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [t.to as `0x${string}`, parseUnits(String(t.amountUsdc), USDC_DECIMALS)] }),
});

export async function createSmartPayer(): Promise<SmartPayer> {
  const provider = await CdpSmartWalletProvider.configureWithWallet({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
    networkId: "base-sepolia",
    address: (process.env.PAYRUN_SMART_WALLET_ADDRESS as `0x${string}`) || undefined,
    owner: (process.env.PAYRUN_SMART_OWNER_ADDRESS as `0x${string}`) || undefined,
    smartAccountName: process.env.PAYRUN_SMART_WALLET_ADDRESS ? undefined : "payrun-payroll",
    paymasterUrl: process.env.PAYRUN_PAYMASTER_URL || undefined,
  });
  const agentkit = await AgentKit.from({ walletProvider: provider, actionProviders: [erc20ActionProvider()] });
  const balanceAction = agentkit.getActions().find((a) => a.name.endsWith("_get_balance"))!;
  const cdp = provider.getClient();
  const smartAccount = provider.smartAccount;
  const ownerAddress = provider.ownerAccount.address;

  async function send(transfers: BatchTransfer[]): Promise<BatchResult> {
    let userOpHash: `0x${string}`;
    try {
      const op = await cdp.evm.sendUserOperation({
        smartAccount,
        network: "base-sepolia",
        calls: transfers.map(transferCall),
        paymasterUrl: provider.getPaymasterUrl(),
      });
      userOpHash = op.userOpHash;
    } catch (e) {
      // Refused before it was sent (e.g. by the signer's rules): nothing moved.
      return { ok: false, txHash: null, message: e instanceof Error ? e.message : String(e) };
    }
    try {
      const done = await cdp.evm.waitForUserOperation({ smartAccountAddress: smartAccount.address, userOpHash });
      if (done.status === "complete") return { ok: true, txHash: done.transactionHash, userOpHash, message: `${transfers.length} transfers in user operation ${userOpHash}` };
      return { ok: false, txHash: null, userOpHash, message: `User operation ${userOpHash} failed onchain.` };
    } catch (e) {
      // Sent, but not confirmed: the money may have moved. Never treat this as unpaid.
      return { ok: false, unconfirmed: true, txHash: null, userOpHash, message: `User operation ${userOpHash} was sent but not confirmed (${e instanceof Error ? e.message : String(e)}). Check it before paying these invoices again.` };
    }
  }

  return {
    address: smartAccount.address,
    ownerAddress,
    async balance() {
      const message = await balanceAction.invoke({ tokenAddress: USDC_BASE_SEPOLIA });
      const n = /is ([0-9.]+)\s*$/.exec(message.trim())?.[1];
      return { usdc: n === undefined ? null : Number(n), message };
    },
    payBatch: send,
    async transfer(to, amountUsdc) {
      const r = await send([{ to, amountUsdc }]);
      return { ok: r.ok, txHash: r.txHash, message: r.message };
    },
    async applyPolicy(policy, contractors, owner) {
      const created = await cdp.policies.createPolicy({ policy: compileWalletPolicy(contractors, policy, { owner, operation: "sendUserOperation" }) });
      await cdp.evm.updateAccount({ address: ownerAddress as `0x${string}`, update: { accountPolicy: created.id } });
      return created.id;
    },
  };
}


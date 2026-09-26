import type { AgentWallet } from "./agent";

/**
 * Pay-run batching. The agent still decides and pays one invoice at a time, but a
 * batching wallet queues each approved transfer instead of sending it; when the
 * run ends, every queued transfer settles in one user operation from the smart
 * payroll wallet: one signature, one onchain transaction, gas sponsored. Coinbase's
 * signer checks every call in the batch against the same rules.
 */
export interface BatchTransfer {
  to: string;
  amountUsdc: number;
}

export interface BatchResult {
  ok: boolean;
  /** The transaction that settled the batch. */
  txHash: string | null;
  /** The user operation, when the wallet reports it. */
  userOpHash?: string | null;
  message: string;
}

/** A wallet that can settle several USDC transfers in one go (the smart payroll wallet). */
export interface BatchSender {
  address: string;
  balance(): Promise<{ usdc: number | null; message: string }>;
  payBatch(transfers: BatchTransfer[]): Promise<BatchResult>;
}

export interface BatchingWallet extends AgentWallet {
  queued: BatchTransfer[];
  /** Settle everything queued in one user operation. Resolves null when nothing was queued. */
  flush(): Promise<BatchResult | null>;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function batchingWallet(sender: BatchSender): BatchingWallet {
  const queued: BatchTransfer[] = [];
  const committed = () => round6(queued.reduce((s, t) => s + t.amountUsdc, 0));
  return {
    address: sender.address,
    queued,
    // What the agent can still spend: the wallet's balance less what this run already queued.
    async balance() {
      const b = await sender.balance();
      if (b.usdc === null || !queued.length) return b;
      const left = round6(b.usdc - committed());
      return { usdc: left, message: `${b.message} (${committed()} already queued in this pay run, so ${left} is free)` };
    },
    async transfer(to, amountUsdc) {
      queued.push({ to, amountUsdc });
      return { ok: true, txHash: null, queued: true, message: `Queued: settles with the pay run's batch (${queued.length} so far).` };
    },
    async flush() {
      if (!queued.length) return null;
      return sender.payBatch([...queued]);
    },
  };
}

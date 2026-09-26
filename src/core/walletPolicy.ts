import type { CreatePolicyBody } from "@coinbase/cdp-sdk";
import { parseUnits } from "viem";
import type { Contractor, PolicyVersion } from "./types";

/** Circle's USDC on Base Sepolia. */
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;

/**
 * Testnet faucets hand out a few USDC, so on Base Sepolia invoices settle at a
 * fixed, disclosed scale (default 1/1000: a 4,200 USDC invoice moves 4.2 test USDC).
 * Every receipt records both the invoice amount and the settled amount.
 */
export function settlementScale(): number {
  const v = Number(process.env.PAYRUN_SETTLEMENT_SCALE ?? "0.001");
  return Number.isFinite(v) && v > 0 ? v : 0.001;
}

export function toSettled(amountUsdc: number, scale = settlementScale()): number {
  return Math.round(amountUsdc * scale * 10 ** USDC_DECIMALS) / 10 ** USDC_DECIMALS;
}

/** The most a contractor can ever be paid in one transfer: a full month at the agreed rate. */
export function agreementMaxUsdc(c: Contractor): number {
  return c.dayRateUsdc * c.monthlyDayCap;
}

/** CDP accepts at most 10 rules per policy. */
export const MAX_POLICY_RULES = 10;

export interface WalletPolicyOptions {
  scale?: number;
  /**
   * The company owner's own wallet. When set, one more rule lets the payroll
   * wallet send USDC back to it (any amount), so the owner can always withdraw.
   * Every other address is still refused.
   */
  owner?: string | null;
  /**
   * Which signing operation the rules govern. An EOA payroll wallet sends
   * transactions (`sendEvmTransaction`); a smart account sends user operations
   * (`sendUserOperation`), where every call in a batch must match a rule.
   */
  operation?: "sendEvmTransaction" | "sendUserOperation";
}

/**
 * Compile the hard invariants into a CDP account policy, enforced by Coinbase's
 * signer rather than by our code or any model:
 *   - the wallet can only call `transfer` on USDC, on Base Sepolia,
 *   - only to a wallet in the address book,
 *   - for at most that contractor's agreement maximum (at the settlement scale).
 * A transaction that matches no accept rule is rejected by the signer.
 *
 * With an owner wallet on file, one extra rule allows withdrawals to it.
 *
 * AgentKit's transfer goes through `sendEvmTransaction`, so that is the only
 * operation accepted. With more contractors than CDP's rule limit, the per-
 * contractor caps collapse into one rule: any address-book wallet, largest cap.
 */
export function compileWalletPolicy(contractors: Contractor[], policy: PolicyVersion, opts: WalletPolicyOptions = {}): CreatePolicyBody {
  const scale = opts.scale ?? settlementScale();
  const owner = opts.owner || null;
  const operation = opts.operation ?? "sendEvmTransaction";
  if (owner && contractors.some((c) => c.wallet.toLowerCase() === owner.toLowerCase())) {
    throw new Error("The owner wallet is also a contractor's wallet; withdrawals would lift that contractor's cap.");
  }
  const usdc = { type: "evmAddress" as const, addresses: [USDC_BASE_SEPOLIA as `0x${string}`], operator: "in" as const };
  // User-operation rules have no network criterion; the smart account's network is fixed at send time.
  const baseSepolia = operation === "sendEvmTransaction" ? [{ type: "evmNetwork" as const, networks: ["base-sepolia" as const], operator: "in" as const }] : [];
  const units = (usdcAmount: number) => parseUnits(String(toSettled(usdcAmount, scale)), USDC_DECIMALS).toString();
  const rule = (wallets: string[], maxUsdc: number | null) => ({
    action: "accept" as const,
    operation,
    criteria: [
      ...baseSepolia,
      usdc,
      {
        type: "evmData" as const,
        abi: "erc20" as const,
        conditions: [
          {
            function: "transfer",
            params: [
              { name: "to", operator: "in" as const, values: wallets },
              ...(maxUsdc === null ? [] : [{ name: "value", operator: "<=" as const, value: units(maxUsdc) }]),
            ],
          },
        ],
      },
    ],
  });
  const room = MAX_POLICY_RULES - (owner ? 1 : 0);
  const rules = [
    ...(contractors.length <= room
      ? contractors.map((c) => rule([c.wallet], agreementMaxUsdc(c)))
      : [rule(contractors.map((c) => c.wallet), Math.max(...contractors.map(agreementMaxUsdc)))]),
    // Withdrawals: back to the owner, uncapped (it is the owner's own money).
    ...(owner ? [rule([owner], null)] : []),
  ];
  return {
    scope: "account",
    // CDP allows 50 chars of [A-Za-z0-9 ,.]
    description: `Payrun ${operation === "sendUserOperation" ? "batch " : ""}policy v${policy.version} ${policy.hash.slice(0, 12)}`,
    // One shape for both operations; the SDK types each operation separately.
    rules: rules as unknown as CreatePolicyBody["rules"],
  };
}

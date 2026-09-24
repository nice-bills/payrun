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

/**
 * Compile the hard invariants into a CDP account policy, enforced by Coinbase's
 * signer rather than by our code or any model:
 *   - the wallet can only call `transfer` on USDC, on Base Sepolia,
 *   - only to a wallet in the address book,
 *   - for at most that contractor's agreement maximum (at the settlement scale).
 * A transaction that matches no accept rule is rejected by the signer.
 *
 * AgentKit's transfer goes through `sendEvmTransaction`, so that is the only
 * operation accepted. With more contractors than CDP's rule limit, the per-
 * contractor caps collapse into one rule: any address-book wallet, largest cap.
 */
export function compileWalletPolicy(contractors: Contractor[], policy: PolicyVersion, scale = settlementScale()): CreatePolicyBody {
  const usdc = { type: "evmAddress" as const, addresses: [USDC_BASE_SEPOLIA as `0x${string}`], operator: "in" as const };
  const baseSepolia = { type: "evmNetwork" as const, networks: ["base-sepolia" as const], operator: "in" as const };
  const units = (usdcAmount: number) => parseUnits(String(toSettled(usdcAmount, scale)), USDC_DECIMALS).toString();
  const rule = (wallets: string[], maxUsdc: number) => ({
    action: "accept" as const,
    operation: "sendEvmTransaction" as const,
    criteria: [
      baseSepolia,
      usdc,
      {
        type: "evmData" as const,
        abi: "erc20" as const,
        conditions: [
          {
            function: "transfer",
            params: [
              { name: "to", operator: "in" as const, values: wallets },
              { name: "value", operator: "<=" as const, value: units(maxUsdc) },
            ],
          },
        ],
      },
    ],
  });
  const rules: CreatePolicyBody["rules"] =
    contractors.length <= MAX_POLICY_RULES
      ? contractors.map((c) => rule([c.wallet], agreementMaxUsdc(c)))
      : [rule(contractors.map((c) => c.wallet), Math.max(...contractors.map(agreementMaxUsdc)))];
  return {
    scope: "account",
    // CDP allows 50 chars of [A-Za-z0-9 ,.]
    description: `Payrun policy v${policy.version} ${policy.hash.slice(0, 12)}`,
    rules,
  };
}

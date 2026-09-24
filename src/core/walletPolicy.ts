import type { CreatePolicyBody } from "@coinbase/cdp-sdk";
import { parseUnits } from "viem";
import type { Contractor, PolicyVersion } from "./types.js";

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

/**
 * Compile the hard invariants into a CDP account policy, enforced by Coinbase's
 * signer rather than by our code or any model:
 *   - the wallet can only call `transfer` on USDC,
 *   - only to a wallet in the address book,
 *   - for at most that contractor's agreement maximum (at the settlement scale),
 *   - only on Base Sepolia.
 * Anything that matches no accept rule is rejected by the signer.
 */
export function compileWalletPolicy(contractors: Contractor[], policy: PolicyVersion, scale = settlementScale()): CreatePolicyBody {
  const usdc = { type: "evmAddress" as const, addresses: [USDC_BASE_SEPOLIA as `0x${string}`], operator: "in" as const };
  const baseSepolia = { type: "evmNetwork" as const, networks: ["base-sepolia" as const], operator: "in" as const };
  const rules: CreatePolicyBody["rules"] = contractors.flatMap((c) => {
    const transferToContractor = {
      type: "evmData" as const,
      abi: "erc20" as const,
      conditions: [
        {
          function: "transfer",
          params: [
            { name: "to", operator: "in" as const, values: [c.wallet] },
            { name: "value", operator: "<=" as const, value: parseUnits(String(toSettled(agreementMaxUsdc(c), scale)), USDC_DECIMALS).toString() },
          ],
        },
      ],
    };
    return [
      { action: "accept" as const, operation: "sendEvmTransaction" as const, criteria: [baseSepolia, usdc, transferToContractor] },
      { action: "accept" as const, operation: "signEvmTransaction" as const, criteria: [usdc, transferToContractor] },
    ];
  });
  return {
    scope: "account",
    description: `Payrun policy v${policy.version} (${policy.hash.slice(0, 12)}): USDC to address book only, capped per agreement`,
    rules,
  };
}

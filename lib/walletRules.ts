import { createHash } from "node:crypto";
import { compileWalletPolicy } from "@/src/core/walletPolicy";
import type { Contractor, PolicyVersion } from "@/src/core/types";

/** The rules part of the compiled wallet policy, hashed: if it changes, the wallet needs the new rules. */
export function walletRulesFingerprint(contractors: Contractor[], policy: PolicyVersion): string {
  return createHash("sha256").update(JSON.stringify(compileWalletPolicy(contractors, policy).rules)).digest("hex").slice(0, 16);
}

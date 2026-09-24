import { createHash } from "node:crypto";
import { compileWalletPolicy } from "@/src/core/walletPolicy";
import type { Contractor, PolicyVersion } from "@/src/core/types";

/** The rules part of the compiled wallet policy, hashed: if it changes, the wallet needs the new rules. */
export function walletRulesFingerprint(contractors: Contractor[], policy: PolicyVersion, owner: string | null): string {
  return createHash("sha256").update(JSON.stringify(compileWalletPolicy(contractors, policy, { owner }).rules)).digest("hex").slice(0, 16);
}

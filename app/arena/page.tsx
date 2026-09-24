import type { Metadata } from "next";
import { Arena } from "@/components/arena/Arena";
import { ARENA_POLICY, ARENA_TERMS, arenaMaxSettled } from "@/src/core/arena";

export const metadata: Metadata = {
  title: "Scam Payrun",
  description: "We gave an AI payroll agent a wallet. Send it any invoice. If it pays you, you keep it.",
};

export default function ArenaPage() {
  return (
    <Arena
      policy={ARENA_POLICY.split("\n").map((l) => l.replace(/^\d+\.\s*/, ""))}
      terms={{ ...ARENA_TERMS, maxPayout: arenaMaxSettled() }}
      boardUrl={process.env.NEXT_PUBLIC_ARENA_BOARD_URL ?? "https://container-pd2mspsteh5k.fly.dev/arena/board"}
      paywallUrl={process.env.NEXT_PUBLIC_ARENA_PAYWALL_URL ?? "https://platform.openserv.ai/workspace/paywall/09f842a0b0f44028bdb12f90dffee47f"}
      fee={process.env.NEXT_PUBLIC_ARENA_FEE_USD ?? "0.05"}
    />
  );
}

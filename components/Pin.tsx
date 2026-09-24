import type { Verdict } from "@/src/core/types";

const HEAD: Record<Verdict | "none", string> = {
  PAY: "var(--color-pin-pay)",
  HOLD: "var(--color-pin-hold)",
  BLOCK: "var(--color-pin-block)",
  none: "var(--color-ink-3)",
};

/** A pushpin. Its head colour carries the verdict; the word next to it carries the meaning. */
export function Pin({ verdict, className = "" }: { verdict: Verdict | null; className?: string }) {
  const fill = HEAD[verdict ?? "none"];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`size-6 ${className}`}>
      <ellipse cx="13" cy="15" rx="7" ry="3" fill="oklch(0.2 0.05 55 / 0.35)" />
      <circle cx="12" cy="11" r="8" fill={fill} />
      <circle cx="12" cy="11" r="8" fill="none" stroke="oklch(0.2 0.04 250 / 0.35)" strokeWidth="1" />
      <circle cx="9.5" cy="8.5" r="2.4" fill="oklch(1 0 0 / 0.55)" />
    </svg>
  );
}

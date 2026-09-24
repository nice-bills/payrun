"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usdc } from "@/lib/format";

const NAV = [
  { href: "/desk", label: "Desk" },
  { href: "/policy", label: "Policy" },
  { href: "/payouts", label: "Payouts" },
  { href: "/proof", label: "Proof" },
];

export function Wordmark() {
  return (
    <span className="relative inline-block font-sans text-[1.35rem] font-black tracking-[-0.03em] text-ink">
      Payrun
      {/* A quick red-pen underline, drawn once. */}
      <svg aria-hidden viewBox="0 0 120 10" className="absolute -bottom-1.5 left-0 h-2 w-full text-pen" preserveAspectRatio="none">
        <path d="M2 6 C 30 2, 60 9, 118 3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function TopBar({
  policyVersion,
  toPay,
  toPayUsdc,
  paidCount,
}: {
  policyVersion: number | null;
  toPay: number;
  toPayUsdc: number;
  paidCount: number;
}) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-desk/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Link href="/desk" aria-label="Payrun desk">
          <Wordmark />
        </Link>
        <nav aria-label="Sections" className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-sheet text-ink shadow-[var(--shadow-slip)]" : "text-ink-2 hover:text-ink"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {policyVersion ? (
            <Link
              href="/policy"
              className="hidden rounded-full border border-rule bg-sheet px-3 py-1 font-type text-xs text-ink-2 hover:text-ink sm:inline-block"
            >
              Policy v{policyVersion}
            </Link>
          ) : null}
          {toPay > 0 ? (
            <Link
              href="/payouts"
              className="press rounded-lg bg-violet px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-slip)] hover:bg-violet-press"
            >
              Pay {toPay} approved · {usdc(toPayUsdc)} USDC
            </Link>
          ) : paidCount > 0 ? (
            <Link href="/payouts" className="text-sm font-medium text-pay hover:underline">
              ✓ {paidCount} paid
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

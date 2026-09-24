"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usdc } from "@/lib/format";

const NAV = [
  { href: "/desk", label: "Desk" },
  { href: "/policy", label: "Policy" },
  { href: "/payouts", label: "Payouts" },
  { href: "/proof", label: "Proof" },
];

export function Wordmark({ onDesk = true }: { onDesk?: boolean }) {
  return (
    <span className={`relative inline-block font-sans text-[1.45rem] font-black tracking-[-0.04em] ${onDesk ? "text-on-desk" : "text-ink"}`}>
      Payrun
      <svg aria-hidden viewBox="0 0 120 10" className="absolute -bottom-1.5 left-0 h-2 w-full text-marker" preserveAspectRatio="none">
        <path d="M2 6 C 30 2, 60 9, 118 3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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
    <header className="z-20 shrink-0 border-b border-desk-line bg-desk-deep">
      <div className="mx-auto flex h-16 max-w-[1520px] items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <Link href="/desk" aria-label="Payrun desk" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label="Sections" className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                  active ? "text-ink" : "text-on-desk-2 hover:text-on-desk"
                }`}
              >
                {/* The pill glides to the current section: "where am I". */}
                {active ? (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-sheet" transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }} />
                ) : null}
                <span className="relative">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {policyVersion ? (
            <Link href="/policy" className="hidden font-type text-xs text-on-desk-2 hover:text-on-desk md:inline">
              policy v{policyVersion}
            </Link>
          ) : null}
          {toPay > 0 ? (
            <Link
              href="/payouts"
              className="press rounded-xl bg-marker px-4 py-2 text-sm font-bold text-ink shadow-[var(--shadow-card)] hover:bg-marker-press"
            >
              Pay {toPay} · {usdc(toPayUsdc)} USDC
            </Link>
          ) : paidCount > 0 ? (
            <Link href="/payouts" className="rounded-xl bg-card-pay px-3.5 py-2 text-sm font-bold text-ink">
              ✓ {paidCount} paid
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

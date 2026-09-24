"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { payApproved, tryScammerTransfer } from "@/app/actions";
import { Stamp } from "@/components/Stamp";
import { shortHash, usdc } from "@/lib/format";
import type { PaymentResult } from "@/src/core/pay";

export interface TagRow {
  id: string;
  name: string;
  wallet: string;
  maxUsdc: number;
  maxSettled: number;
}

export interface DueRow {
  invoiceId: string;
  name: string;
  amountUsdc: number;
}

const SCAMMER = "0x94e672298C44c94b0606740cBEfa6963fA3409C6";

export function PayoutsBoard({
  due,
  paid,
  tags,
  payer,
  scale,
}: {
  due: DueRow[];
  paid: (PaymentResult & { name: string })[];
  tags: TagRow[];
  payer: string | null;
  scale: number;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [working, setWorking] = useState<"pay" | "scam" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scam, setScam] = useState<{ refused: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();
  const dueTotal = due.reduce((s, d) => s + d.amountUsdc, 0);

  const pay = () => {
    setError(null);
    setWorking("pay");
    startTransition(async () => {
      const r = await payApproved();
      setWorking(null);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  const scamTry = () => {
    setError(null);
    setScam(null);
    setWorking("scam");
    startTransition(async () => {
      const r = await tryScammerTransfer();
      setWorking(null);
      if (!r.ok) return setError(r.error);
      setScam(r.value);
    });
  };

  return (
    <div className="mx-auto grid h-full max-w-[1520px] grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_460px] lg:overflow-hidden">
      {/* The pay run */}
      <main className="px-4 pb-12 pt-6 sm:px-8 lg:scroll-y lg:min-h-0">
        <div className="mx-auto max-w-[720px]">
          <h1 className="text-[2.6rem] font-black leading-none tracking-[-0.045em] text-on-desk">
            {due.length ? `${due.length} to pay` : "Nothing left to pay"}
          </h1>
          <p className="mt-2 text-on-desk-2">
            {due.length
              ? `${usdc(dueTotal)} USDC, each to the wallet on file. Testnet moves 1/${Math.round(1 / scale)} of it.`
              : `${paid.length} invoice${paid.length === 1 ? "" : "s"} paid this month. Every transfer is on Base Sepolia.`}
          </p>

          {due.length ? (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={pay}
                disabled={!!working}
                className="press rounded-2xl bg-marker px-6 py-3.5 text-lg font-black text-ink shadow-[var(--shadow-card)] hover:bg-marker-press disabled:cursor-progress disabled:opacity-70"
              >
                {working === "pay" ? "Paying…" : `Pay ${due.length} · ${usdc(dueTotal)} USDC`}
              </button>
              <ul className="flex flex-wrap gap-2">
                {due.map((d) => (
                  <li key={d.invoiceId} className="rounded-lg bg-card-pay px-2.5 py-1 text-sm font-bold text-ink">
                    {d.name.split(" ")[0]} {usdc(d.amountUsdc)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <p role="alert" className="mt-4 font-bold text-card-block">{error}</p> : null}

          <div className="mt-10 flex items-baseline justify-between">
            <h2 className="text-lg font-black tracking-[-0.02em] text-on-desk">Receipts</h2>
            <a href="/receipts.csv" className="text-sm font-bold text-marker underline-offset-4 hover:underline">
              Download CSV for the books
            </a>
          </div>
          <ul className="mt-4 grid gap-5 sm:grid-cols-2">
            {paid.map((p, n) => (
              <motion.li
                key={`${p.invoiceId}-${p.sentAt}`}
                initial={reduce ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(n, 6) * 0.04, ease: [0.23, 1, 0.32, 1] }}
                className="receipt bg-sheet px-5 pt-4 font-type text-[0.8rem] text-ink shadow-[var(--shadow-card)]"
              >
                <p className="text-center font-sans text-xs font-black tracking-[0.2em]">PAYRUN · BASE SEPOLIA</p>
                <p className="mt-1 text-center text-[0.7rem] text-ink-2">{new Date(p.sentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
                <div className="my-3 border-t border-dashed border-ink-3" />
                <p className="flex justify-between gap-3">
                  <span className="truncate font-bold">{p.name}</span>
                  <span className="font-bold">{usdc(p.amountUsdc)}</span>
                </p>
                <p className="flex justify-between gap-3 text-ink-2">
                  <span className="truncate">{p.invoiceId.replace(/^\d+-/, "")}</span>
                  <span>USDC</span>
                </p>
                <div className="my-3 border-t border-dashed border-ink-3" />
                <p className="flex justify-between">
                  <span>Moved</span>
                  <span>{p.settledUsdc} test USDC</span>
                </p>
                <p className="flex justify-between">
                  <span>To</span>
                  <span>{shortHash(p.to)}</span>
                </p>
                <p className="mt-2 text-center font-sans text-sm font-black tracking-[0.14em] text-pay">{p.status === "sent" ? "✓ SENT" : p.status.toUpperCase()}</p>
                {p.txHash ? (
                  <a
                    href={`https://sepolia.basescan.org/tx/${p.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-center text-[0.72rem] text-violet underline underline-offset-2"
                  >
                    {shortHash(p.txHash)} ↗
                  </a>
                ) : null}
              </motion.li>
            ))}
          </ul>
        </div>
      </main>

      {/* The wallet's own rules */}
      <aside aria-label="Wallet rules" className="px-4 pb-12 pt-6 sm:px-8 lg:scroll-y lg:min-h-0 lg:pl-2">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-on-desk">The wallet&apos;s own rules</h2>
        <p className="mt-1 max-w-[40ch] text-sm text-on-desk-2">
          Compiled from the same policy and attached to the paying wallet{payer ? ` (${shortHash(payer)})` : ""}. Coinbase&apos;s signer enforces them, not Payrun and not a model.
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {tags.map((t, n) => (
            <li key={t.id} className="flex items-center" style={{ rotate: `${n % 2 ? 0.6 : -0.6}deg` }}>
              <svg aria-hidden viewBox="0 0 40 10" className="h-3 w-10 shrink-0 text-on-desk-2">
                <path d="M0 5 C 12 1, 26 9, 40 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <div className="tag flex flex-1 items-center justify-between gap-3 bg-card-hold py-2.5 pr-4 shadow-[var(--shadow-card)]">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-ink">{t.name}</span>
                  <span className="block font-type text-[0.7rem] text-ink-2">{shortHash(t.wallet)}</span>
                </span>
                <span className="text-right">
                  <span className="block font-type text-sm font-bold text-ink">≤ {usdc(t.maxUsdc)}</span>
                  <span className="block font-type text-[0.65rem] text-ink-2">{t.maxSettled} test USDC</span>
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-2xl bg-desk-deep p-5">
          <p className="text-lg font-black tracking-[-0.02em] text-on-desk">What if a model got fooled?</p>
          <p className="mt-1 text-sm text-on-desk-2">Skip every check and ask the wallet directly to pay the address from Akosua&apos;s &quot;new wallet&quot; email.</p>
          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={scamTry}
              disabled={!!working}
              className="press rounded-xl bg-block px-4 py-2.5 text-sm font-black text-sheet shadow-[var(--shadow-card)] hover:brightness-110 disabled:cursor-progress disabled:opacity-70"
            >
              {working === "scam" ? "Asking the signer…" : `Pay ${shortHash(SCAMMER)} 1 USDC`}
            </button>
          </div>
          {scam ? (
            <div className="mt-5 flex items-center gap-4 rounded-xl bg-sheet p-4">
              <Stamp verdict={scam.refused ? "BLOCK" : "PAY"} size="sm" fresh />
              <p className="text-sm text-ink">
                <b>{scam.refused ? "Refused by Coinbase's signer." : "It went through."}</b> <span className="text-ink-2">{scam.message}</span>
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Stamp } from "@/components/Stamp";
import { Wordmark } from "@/components/TopBar";
import type { Verdict } from "@/src/core/types";

type Layer = "Prompt Guard" | "Payrun checks" | "SERV" | "Coinbase signer";

interface BoardAttempt {
  id: string;
  at: string;
  handle: string | null;
  wallet: string;
  verdict: Verdict;
  caughtBy: Layer | null;
  clauses: number[];
  reason: string;
  paidUsdc: number;
  txHash: string | null;
}

interface Board {
  stats: { attempts: number; won: number; paidOutTestUsdc: number; caughtBy: Record<Layer, number> };
  attempts: BoardAttempt[];
}

const EASE = [0.23, 1, 0.32, 1] as const;

/** The four layers, in the order an invoice meets them. */
const LAYERS: { name: Layer; what: string }[] = [
  { name: "Prompt Guard", what: "SERV reads your invoice alone first. An instruction aimed at the reviewer is refused before any model sees it." },
  { name: "Payrun checks", what: "Code checks the facts it never lets a model guess: sums, rate, day cap, the wallet on file." },
  { name: "SERV", what: "The policy is compiled into SERV's reasoning graph. The agent pays, holds or blocks through its wallet tools." },
  { name: "Coinbase signer", what: "The wallet's own rule: no transfer above one agreement, whatever the agent decides." },
];

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function Arena({
  policy,
  terms,
  boardUrl,
  paywallUrl,
  fee,
}: {
  policy: string[];
  terms: { dayRateUsdc: number; monthlyDayCap: number; maxPayout: number };
  boardUrl: string;
  paywallUrl: string | null;
  fee: string;
}) {
  const reduce = useReducedMotion();
  const [board, setBoard] = useState<Board | null>(null);
  const [down, setDown] = useState(false);

  // The board lives next to the agent; refresh it while the page is open.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(boardUrl, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const b = (await r.json()) as Board;
        if (alive) {
          setBoard(b);
          setDown(false);
        }
      } catch {
        if (alive) setDown(true);
      }
    };
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [boardUrl]);

  const stats = board?.stats;

  return (
    <div className="cork min-h-dvh text-ink">
      <header className="mx-auto flex max-w-[1240px] items-center gap-6 px-5 py-6 sm:px-8">
        <Link href="/" aria-label="Payrun home">
          <Wordmark tone="paper" />
        </Link>
        <nav className="ml-auto flex items-center gap-5 text-sm font-bold">
          <Link href="/proof" className="hidden hover:underline sm:inline">
            Proof
          </Link>
          <Link href="/desk" className="press rounded-[3px] bg-ink px-4 py-2 text-paper hover:bg-band">
            Open the desk
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pt-12">
        <div>
          <p className="font-type text-sm">Scam Payrun · a public challenge</p>
          <h1 className="mt-3 text-[clamp(2.6rem,6.4vw,5rem)] font-black leading-[0.95] tracking-[-0.045em]">
            We gave an AI payroll agent a wallet.
            <br />
            <span className="text-pen">Try to scam it.</span>
          </h1>
          <p className="mt-7 max-w-[48ch] text-lg leading-relaxed">
            Send it any invoice you like. Hidden text, fake approvals, a sob story about a frozen wallet. The policy approves no work this month, so it should pay nobody.{" "}
            <b>If it pays you, you keep it.</b>
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            {paywallUrl ? (
              <a href={paywallUrl} target="_blank" rel="noreferrer" className="press rounded-[3px] bg-marker px-6 py-3.5 text-lg font-black text-ink hover:bg-marker-press">
                Send an invoice · ${fee}
              </a>
            ) : (
              <span className="rounded-[3px] bg-paper px-5 py-3 font-bold shadow-[var(--shadow-press)]">Opening soon</span>
            )}
            <span className="font-type text-xs">Paid over x402 on OpenServ · test USDC on Base Sepolia</span>
          </div>
          <p className="mt-4 max-w-[52ch] text-sm">
            On the entry form: your Base Sepolia wallet (where the agent would pay you), your invoice, and an X handle for the board. {`Five tries per wallet a day.`}
          </p>
        </div>

        {/* The rules, as the agent reads them. */}
        <div className="legal-pad relative rounded-[3px] p-6 pl-14 shadow-[var(--shadow-card)] sm:p-8 sm:pl-16" style={{ rotate: "0.6deg" }}>
          <p className="font-hand text-2xl text-pen">The policy it holds you to</p>
          <ol className="mt-3 flex flex-col gap-2.5 text-[0.95rem] leading-snug">
            {policy.map((c, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_1fr]">
                <span className="font-type font-bold">{i + 1}.</span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-pad-line pt-4 font-type text-xs leading-relaxed">
            Your agreement: {terms.dayRateUsdc} USDC a day, up to {terms.monthlyDayCap} days. Invoices settle at 1/1000 on testnet, so the most one payment can be is{" "}
            {terms.maxPayout} test USDC, and Coinbase&apos;s signer enforces that cap.
          </p>
        </div>
      </section>

      {/* Scoreboard */}
      <section className="mx-auto max-w-[1240px] px-5 pb-10 sm:px-8" aria-label="Scoreboard">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { k: "Attempts", v: stats ? stats.attempts.toLocaleString("en-US") : "…" },
            { k: "Times it paid", v: stats ? String(stats.won) : "…" },
            { k: "Paid out", v: stats ? `${stats.paidOutTestUsdc} test USDC` : "…" },
          ].map((s) => (
            <div key={s.k} className="rounded-[3px] bg-band p-5 text-on-band shadow-[var(--shadow-paper)]">
              <p className="font-type text-xs text-on-band-2">{s.k}</p>
              <p className="mt-1 text-4xl font-black tracking-[-0.04em] tabular-nums">{s.v}</p>
            </div>
          ))}
        </div>
        {down ? <p className="mt-3 font-type text-xs">The board is not answering right now. Attempts still count.</p> : null}
      </section>

      <section className="mx-auto grid max-w-[1240px] gap-10 px-5 pb-24 sm:px-8 lg:grid-cols-[360px_1fr]">
        <div>
          <h2 className="text-2xl font-black tracking-[-0.03em]">What stands in your way</h2>
          <ol className="mt-5 flex flex-col gap-3">
            {LAYERS.map((l, i) => (
              <li key={l.name} className="rounded-[3px] bg-paper p-4 shadow-[var(--shadow-press)]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-black">
                    <span className="font-type text-ink-2">{i + 1}.</span> {l.name}
                  </p>
                  <p className="font-type text-sm font-bold tabular-nums">{stats ? `${stats.caughtBy[l.name]} caught` : ""}</p>
                </div>
                <p className="mt-1 text-sm text-ink-2">{l.what}</p>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h2 className="text-2xl font-black tracking-[-0.03em]">Latest attempts</h2>
          {board && board.attempts.length === 0 ? <p className="mt-5 rounded-[3px] bg-paper p-5 shadow-[var(--shadow-press)]">No attempts yet. Be the first.</p> : null}
          {!board && !down ? <div className="skeleton mt-5 h-40 rounded-[3px]" aria-hidden /> : null}
          <ol className="mt-5 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {board?.attempts.map((a) => (
                <motion.li
                  key={a.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className={`flex items-center gap-4 rounded-[3px] p-4 shadow-[var(--shadow-card)] ${a.caughtBy ? "bg-paper" : "bg-marker"}`}
                >
                  <Stamp verdict={a.verdict} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <b>{a.handle ? `@${a.handle}` : a.wallet}</b>
                      <span className="font-type text-xs text-ink-2">{ago(a.at)}</span>
                      <span className="rounded-[2px] bg-band px-1.5 py-0.5 font-type text-[0.68rem] font-bold text-on-band">
                        {a.caughtBy ? `caught by ${a.caughtBy}` : `PAID ${a.paidUsdc} test USDC`}
                      </span>
                      {a.clauses.length ? <span className="font-type text-xs">clause {a.clauses.join(", ")}</span> : null}
                    </p>
                    <p className="mt-1 truncate text-sm text-ink-2" title={a.reason}>
                      {a.reason}
                    </p>
                  </div>
                  {a.txHash ? (
                    <a href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer" className="font-type text-xs underline">
                      tx
                    </a>
                  ) : null}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </div>
      </section>

      <footer className="mx-auto max-w-[1240px] px-5 pb-10 font-type text-xs sm:px-8">
        Testnet only. Invoice text is never published; the board shows only what the defence did. <Link href="/terms" className="underline">Terms</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy</Link>
      </footer>
    </div>
  );
}

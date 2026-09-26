"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Stamp } from "@/components/Stamp";
import type { Verdict } from "@/src/core/types";

const EASE = [0.23, 1, 0.32, 1] as const;

/** The four layers, in the order an invoice meets them. */
const LAYERS = ["Guard", "Checks", "SERV", "Signer"] as const;

interface Card {
  file: string;
  name: string;
  amount: number;
  verdict: Verdict;
  /** Index into LAYERS of the layer that decided. A PAY passes all four. */
  decidedBy: number;
  why: string;
}

/** Cases shaped like the demo pile: one clean, one hidden instruction, one wallet swap, one over the cap, one short wallet, one stranger. */
const PILE: Card[] = [
  { file: "efua-sept.pdf", name: "Efua Boateng", amount: 1500, verdict: "PAY", decidedBy: 3, why: "6 days at 250, inside her cap" },
  { file: "kwame-expense.pdf", name: "Kwame Asante", amount: 1850, verdict: "BLOCK", decidedBy: 0, why: "Hidden orders for the AI" },
  { file: "akosua-0912.eml", name: "Akosua Darko", amount: 4560, verdict: "HOLD", decidedBy: 2, why: "§4 New wallet, not confirmed" },
  { file: "kofi-aug.pdf", name: "Kofi Adjei", amount: 9000, verdict: "BLOCK", decidedBy: 1, why: "30 days billed, cap is 20" },
  { file: "nana-sept.pdf", name: "Nana Yeboah", amount: 3600, verdict: "PAY", decidedBy: 3, why: "12 days at 300, as agreed" },
  { file: "urgent-invoice.txt", name: "0x94e6…09C6", amount: 1000, verdict: "BLOCK", decidedBy: 3, why: "Not in the book. Signer refused" },
];

const TRAYS: { v: Verdict; label: string; cls: string }[] = [
  { v: "PAY", label: "Paid", cls: "text-pay" },
  { v: "HOLD", label: "Held", cls: "text-hold" },
  { v: "BLOCK", label: "Blocked", cls: "text-block" },
];

/** Where a filed card flies: up to Paid, across to Held, down to Blocked. */
const EXIT: Record<Verdict, { x: number; y: number; rotate: number }> = {
  PAY: { x: 260, y: -120, rotate: 8 },
  HOLD: { x: 280, y: 0, rotate: 4 },
  BLOCK: { x: 260, y: 130, rotate: -10 },
};

const fmt = (n: number) => n.toLocaleString("en-US");

function Chip({ name, state, verdict }: { name: string; state: "idle" | "pass" | "decide"; verdict: Verdict }) {
  const decide = { PAY: "bg-pay text-paper", HOLD: "bg-hold text-paper", BLOCK: "bg-block text-paper" }[verdict];
  return (
    <motion.span
      className={`rounded-[2px] px-2 py-1 font-type text-[0.7rem] font-bold transition-colors duration-200 ${
        state === "idle" ? "bg-paper-2 text-ink-3" : state === "pass" ? "bg-paper text-pay ring-1 ring-inset ring-pay/60" : decide
      }`}
      animate={state === "idle" ? { scale: 1 } : { scale: [1, 1.14, 1] }}
      transition={{ duration: 0.25, ease: EASE }}
    >
      {state === "pass" ? "✓ " : ""}
      {name}
    </motion.span>
  );
}

/**
 * A pay run in miniature: invoices come off the pile, pass the four layers one by one,
 * get stamped and fly into Paid, Held or Blocked. Runs only while on screen; hover pauses it.
 */
export function PileMachine() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const [paused, setPaused] = useState(false);
  const [i, setI] = useState(0);
  const [lit, setLit] = useState(0);
  const [stamped, setStamped] = useState(false);
  const [filed, setFiled] = useState<Card[]>([]);
  const [resting, setResting] = useState(false);

  const card = resting ? null : PILE[i];
  const last = card ? card.decidedBy : 0;

  useEffect(() => {
    if (reduce || !inView || paused) return;
    let t: ReturnType<typeof setTimeout>;
    if (resting) {
      t = setTimeout(() => {
        setFiled([]);
        setI(0);
        setResting(false);
      }, 2200);
    } else if (!stamped && lit <= last) {
      t = setTimeout(() => setLit(lit + 1), lit === 0 ? 700 : 430);
    } else if (!stamped) {
      t = setTimeout(() => setStamped(true), 150);
    } else {
      t = setTimeout(() => {
        const next = [...filed, PILE[i]];
        setFiled(next);
        setLit(0);
        setStamped(false);
        if (next.length === PILE.length) setResting(true);
        else setI(i + 1);
      }, 1500);
    }
    return () => clearTimeout(t);
  }, [reduce, inView, paused, resting, stamped, lit, last, filed, i]);

  // Without motion, show the finished run: every card filed, the last one on the desk.
  const shownFiled = reduce ? PILE : filed;
  const onDesk = reduce ? PILE[1] : card;
  const deskLit = reduce ? PILE[1].decidedBy + 1 : lit;
  const deskStamped = reduce || stamped;
  const paidTotal = shownFiled.filter((c) => c.verdict === "PAY").reduce((s, c) => s + c.amount, 0);
  const left = PILE.length - shownFiled.length - (onDesk && !reduce ? 1 : 0);

  return (
    <div ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} className="relative">
      <ul className="sr-only">
        {PILE.map((c) => (
          <li key={c.file}>
            {c.name}, {fmt(c.amount)} USDC: {c.verdict}, {c.why}.
          </li>
        ))}
      </ul>
      <div aria-hidden className="grid items-center gap-8 lg:grid-cols-[150px_minmax(0,1fr)_250px]">
        {/* The pile */}
        <div className="flex items-center gap-4 lg:flex-col lg:items-start">
          <div className="relative h-[92px] w-[120px]">
            {Array.from({ length: Math.max(left, 0) }).map((_, n) => (
              <motion.div
                key={n}
                layout
                className="absolute inset-0 rounded-[3px] bg-paper shadow-[var(--shadow-press)]"
                style={{ rotate: [-3, 2, -1, 3, -2, 1][n % 6], top: -n * 4, left: n * 2 }}
              >
                <div className="mx-3 mt-4 h-1.5 w-2/3 rounded bg-rule" />
                <div className="mx-3 mt-2 h-1.5 w-1/2 rounded bg-rule" />
                <div className="mx-3 mt-2 h-1.5 w-3/5 rounded bg-rule" />
              </motion.div>
            ))}
          </div>
          <p className="font-type text-xs">
            Inbox · <b className="tabular-nums">{Math.max(left, 0)}</b> left
          </p>
        </div>

        {/* The desk */}
        <div className="relative min-h-[260px]">
          <AnimatePresence mode="popLayout">
            {onDesk ? (
              <motion.div
                key={onDesk.file}
                className="relative mx-auto max-w-[380px] overflow-hidden rounded-[3px] bg-paper px-6 pb-5 pt-6 shadow-[var(--shadow-paper)]"
                initial={reduce ? false : { x: -220, y: 20, rotate: -9, opacity: 0 }}
                animate={{ x: 0, y: 0, rotate: -1, opacity: 1 }}
                exit={{ ...EXIT[onDesk.verdict], scale: 0.35, opacity: 0, transition: { duration: 0.55, ease: [0.55, 0, 0.75, 0.3] } }}
                transition={{ duration: 0.55, ease: EASE }}
              >
                {!deskStamped ? (
                  <motion.div
                    className="pointer-events-none absolute inset-x-0 h-7 bg-marker/45 mix-blend-multiply"
                    initial={{ top: "0%" }}
                    animate={{ top: ["0%", "88%", "0%"] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                ) : null}
                <p className="font-type text-[0.7rem] text-ink-2">{onDesk.file}</p>
                <p className="mt-3 text-xl font-black tracking-[-0.03em] text-ink">{onDesk.name}</p>
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 w-4/5 rounded bg-rule" />
                  <div className="h-1.5 w-3/5 rounded bg-rule" />
                </div>
                <p className="mt-3 font-type text-sm text-ink">
                  TOTAL DUE <b>{fmt(onDesk.amount)} USDC</b>
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {LAYERS.map((l, n) => (
                    <Chip
                      key={l}
                      name={l}
                      verdict={onDesk.verdict}
                      state={n >= deskLit ? "idle" : onDesk.verdict !== "PAY" && n === onDesk.decidedBy ? "decide" : "pass"}
                    />
                  ))}
                </div>
                <div className="mt-3 h-7">
                  {deskStamped ? (
                    <motion.p
                      className="font-hand text-[1.35rem] leading-none text-pen"
                      initial={reduce ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.15 }}
                    >
                      {onDesk.why}
                    </motion.p>
                  ) : null}
                </div>
                <div className="absolute right-3 top-3">{deskStamped ? <Stamp verdict={onDesk.verdict} size="lg" fresh={!reduce} /> : null}</div>
              </motion.div>
            ) : (
              <motion.div
                key="cleared"
                className="mx-auto max-w-[380px] pt-20 text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <p className="text-3xl font-black tracking-[-0.04em] text-ink">Pile cleared.</p>
                <p className="mt-1 font-hand text-2xl text-pen">Next month&apos;s is already coming in.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* The trays */}
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          {TRAYS.map((t) => {
            const inTray = shownFiled.filter((c) => c.verdict === t.v);
            return (
              <div key={t.v} className="relative rounded-[3px] bg-manila px-3 pb-3 pt-2 shadow-[var(--shadow-card)]">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`font-sans text-xs font-black uppercase tracking-[0.14em] ${t.cls}`}>{t.label}</p>
                  <motion.b key={inTray.length} className="font-type text-sm tabular-nums text-ink" initial={reduce ? false : { scale: 1.8 }} animate={{ scale: 1 }} transition={{ duration: 0.3, ease: EASE }}>
                    {inTray.length}
                  </motion.b>
                </div>
                <div className="relative mt-2 h-9">
                  <AnimatePresence>
                    {inTray.map((c, n) => (
                      <motion.div
                        key={c.file}
                        className="absolute left-0 right-0 truncate rounded-[2px] bg-paper px-2 py-1 text-[0.7rem] font-bold text-ink shadow-[var(--shadow-press)]"
                        style={{ top: n * 4, rotate: n % 2 ? 1.5 : -1.5, zIndex: n }}
                        initial={reduce ? false : { y: -26, opacity: 0, scale: 1.2 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.2 } }}
                        transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : 0.35 }}
                      >
                        {c.name} · {fmt(c.amount)}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                {t.v === "PAY" ? (
                  <p className="mt-2 font-type text-[0.7rem] text-ink">
                    sent <b className="tabular-nums">{fmt(paidTotal)}</b> USDC
                  </p>
                ) : null}
                {t.v === "PAY" ? (
                  <AnimatePresence>
                    {inTray.length && !reduce ? (
                      <motion.span
                        key={inTray.length}
                        className="pointer-events-none absolute -top-2 right-2 rounded-full bg-pay px-2 py-0.5 font-type text-[0.7rem] font-bold text-paper"
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: -18, opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 1.4, delay: 0.4, ease: "easeOut" }}
                      >
                        +{fmt(inTray[inTray.length - 1].amount)}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-6 text-center font-type text-xs text-ink">{reduce ? "An illustration of a finished run." : paused ? "Paused. Move away to carry on." : "An illustration of a pay run. Hover to pause."}</p>
    </div>
  );
}

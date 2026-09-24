"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reviewInvoice } from "@/app/actions";
import type { DeskItem } from "@/lib/data";
import type { Contractor, Verdict } from "@/src/core/types";
import { InboxTray, whoFor } from "./InboxTray";
import { InvoiceSheet } from "./InvoiceSheet";
import { LegalPad } from "./LegalPad";

/** A count that rolls to its new value, so a verdict landing is visible in the header too. */
function Tally({ n }: { n: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-block min-w-[1ch] overflow-hidden align-bottom tabular-nums">
      <motion.span
        key={n}
        className="inline-block"
        initial={reduce ? false : { y: "-100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        {n}
      </motion.span>
    </span>
  );
}

/** Each invoice stays in focus at least this long during a pile review, so the stamp can be seen. */
const PILE_DWELL_MS = 750;

export function Desk({ items: initial, contractors }: { items: DeskItem[]; contractors: Contractor[] }) {
  const reduce = useReducedMotion();
  const [items, setItems] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.invoice.id ?? null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [pile, setPile] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const names = useMemo(() => new Map(contractors.map((c) => [c.id, c.name])), [contractors]);
  const paperRef = useRef<HTMLDivElement>(null);
  const busy = reviewingId !== null;

  useEffect(() => setItems(initial), [initial]);

  const index = items.findIndex((i) => i.invoice.id === selectedId);
  const item = items[index] ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setError(null);
    setActiveNote(null);
    paperRef.current?.scrollTo({ top: 0 });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (!items.length || busy) return;
      select(items[Math.min(items.length - 1, Math.max(0, index + delta))].invoice.id);
    },
    [items, index, busy, select],
  );

  // j/k and arrows walk the inbox. Frequent, so no transition on the tray itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowDown" || e.key === "j") (e.preventDefault(), move(1));
      if (e.key === "ArrowUp" || e.key === "k") (e.preventDefault(), move(-1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  const readOne = useCallback(async (id: string) => {
    setReviewingId(id);
    const started = Date.now();
    const r = await reviewInvoice(id);
    if (!r.ok) {
      setReviewingId(null);
      setError(r.error);
      return false;
    }
    await new Promise((res) => setTimeout(res, Math.max(0, PILE_DWELL_MS - (Date.now() - started))));
    setItems((prev) => prev.map((x) => (x.invoice.id === id ? { ...x, decision: r.decision } : x)));
    setFresh((prev) => new Set(prev).add(`${id}-${r.decision.decidedAt}`));
    setReviewingId(null);
    return true;
  }, []);

  const reviewPile = async () => {
    if (busy) return;
    const before = items;
    const ids = items.filter((i) => i.paid?.status !== "sent").map((i) => i.invoice.id);
    setError(null);
    setPile({ done: 0, total: ids.length });
    // Clear the unpaid cards so the run is visible: each one fills back in as it is read.
    setItems((prev) => prev.map((x) => (ids.includes(x.invoice.id) ? { ...x, decision: null } : x)));
    for (const [n, id] of ids.entries()) {
      select(id);
      const ok = await readOne(id);
      if (!ok) {
        setItems((prev) => prev.map((x) => x.decision ? x : before.find((b) => b.invoice.id === x.invoice.id) ?? x));
        break;
      }
      setPile({ done: n + 1, total: ids.length });
    }
    setTimeout(() => setPile(null), 1600);
  };

  const count = (v: Verdict) => items.filter((i) => i.decision?.finalVerdict === v).length;

  if (!item) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-ink">
        <div>
          <h1 className="text-3xl font-black tracking-[-0.03em]">The pile is empty</h1>
          <p className="mt-2 text-ink">Put this month&apos;s invoices in the inbox folder and run the ingest command.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid h-full max-w-[1520px] grid-cols-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)_minmax(320px,380px)] lg:overflow-hidden">
      {/* Inbox */}
      <section aria-label="Inbox" className="flex flex-col px-4 pt-5 sm:px-6 lg:min-h-0 lg:pl-6 lg:pr-3">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[1.35rem] font-black tracking-[-0.03em] text-ink">September pile</h1>
            <p className="font-type text-xs font-bold text-ink">
              <Tally n={count("PAY")} /> pay · <Tally n={count("HOLD")} /> hold · <Tally n={count("BLOCK")} /> block
            </p>
          </div>
          <button
            type="button"
            onClick={reviewPile}
            disabled={busy}
            className="press shrink-0 rounded-[3px] bg-marker px-3.5 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:cursor-progress"
          >
            {pile ? (pile.done === pile.total ? `All ${pile.total} read` : `Reading ${pile.done + 1} of ${pile.total}`) : "Review the pile"}
          </button>
        </div>
        {pile ? (
          <div aria-hidden className="mb-2 h-2 overflow-hidden rounded-[2px] bg-cork-deep">
            <motion.div
              className="h-full origin-left bg-marker"
              animate={{ scaleX: pile.total ? pile.done / pile.total : 0 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            />
          </div>
        ) : null}
        <div className="lg:scroll-y lg:-ml-2 lg:min-h-0 lg:flex-1 lg:pl-2">
          <InboxTray items={items} names={names} selectedId={selectedId} reviewingId={reviewingId} onSelect={(id) => !busy && select(id)} />
        </div>
        <p className="hidden py-3 font-type text-[0.7rem] text-ink lg:block">
          <a href="/terms" className="underline underline-offset-2">Terms</a> · <a href="/privacy" className="underline underline-offset-2">Privacy</a> · testnet only
        </p>
      </section>

      {/* The invoice in focus */}
      <main ref={paperRef} className="px-4 pb-10 pt-5 sm:px-8 lg:scroll-y lg:min-h-0">
        <motion.div
          key={item.invoice.id}
          // Slides out of the tray side: "where did this come from".
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: -36, rotate: -1.2 }}
          animate={{ opacity: 1, x: 0, rotate: 0 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          <InvoiceSheet item={item} activeNote={activeNote} fresh={!!item.decision && fresh.has(`${item.invoice.id}-${item.decision.decidedAt}`)} />
        </motion.div>
      </main>

      {/* The reviewer's pad */}
      <div className="px-4 pb-10 pt-5 sm:px-6 lg:scroll-y lg:min-h-0 lg:pb-0 lg:pl-3 lg:pr-6">
        <LegalPad
          item={item}
          who={whoFor(item, names)}
          reviewing={reviewingId === item.invoice.id}
          error={error}
          onReview={() => !busy && readOne(item.invoice.id)}
          onNote={setActiveNote}
        />
      </div>
    </div>
  );
}

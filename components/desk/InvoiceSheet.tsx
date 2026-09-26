"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { Stamp } from "@/components/Stamp";
import type { DeskItem } from "@/lib/data";
import { locateQuote, shortHash, stampDate } from "@/lib/format";
import { kindOf } from "./InboxTray";

type Span = { start: number; end: number; kind: "evidence" | "hidden"; note?: number };

/** Evidence the reviewer cited, located in the invoice text and numbered to match the notes. */
export function citedSpans(text: string, item: DeskItem): Span[] {
  const spans: Span[] = [];
  item.decision?.judgment?.reasons.forEach((r, i) => {
    const at = locateQuote(text, r.evidenceQuote);
    if (at && !spans.some((s) => s.start < at[1] && at[0] < s.end)) spans.push({ start: at[0], end: at[1], kind: "evidence", note: i + 1 });
  });
  return spans;
}

function render(text: string, spans: Span[], activeNote: number | null) {
  const out: React.ReactNode[] = [];
  let cursor = 0;
  [...spans]
    .sort((a, b) => a.start - b.start)
    .forEach((s, i) => {
      if (s.start > cursor) out.push(text.slice(cursor, s.start));
      const piece = text.slice(s.start, s.end);
      out.push(
        s.kind === "hidden" ? (
          <mark key={i} className="bg-pin-block/15 px-1 text-block outline outline-1 outline-block/50">
            {piece}
          </mark>
        ) : (
          <mark key={i} className="evidence text-ink" data-active={activeNote === s.note}>
            {piece}
            <sup className="ml-0.5 font-sans text-[0.7rem] font-black text-pen">{s.note}</sup>
          </mark>
        ),
      );
      cursor = s.end;
    });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function BinderClip() {
  return (
    <svg aria-hidden viewBox="0 0 96 42" className="absolute -top-5 left-1/2 h-10 w-24 -translate-x-1/2">
      <rect x="10" y="22" width="80" height="18" rx="2" fill="var(--color-cork-deep)" />
      <path d="M20 22 L20 6 Q20 2 26 2 L70 2 Q76 2 76 6 L76 22" fill="none" stroke="oklch(0.8 0.01 250)" strokeWidth="3.5" />
      <rect x="8" y="19" width="80" height="18" rx="2" fill="var(--color-ink)" />
      <rect x="8" y="19" width="80" height="4" rx="1.5" fill="oklch(0.4 0.06 258)" />
    </svg>
  );
}

export function InvoiceSheet({ item, fresh, activeNote }: { item: DeskItem; fresh: boolean; activeNote: number | null }) {
  const reduce = useReducedMotion();
  const [showHidden, setShowHidden] = useState(false);
  const d = item.decision;
  const hidden = item.invoice.hiddenText ?? null;
  const text = item.invoice.rawText;

  const { body, spans } = useMemo(() => {
    const hiddenAt = hidden ? locateQuote(text, hidden) : null;
    if (hiddenAt && !showHidden) {
      // What a person sees: the file without its invisible text.
      const visible = (text.slice(0, hiddenAt[0]) + text.slice(hiddenAt[1])).replace(/\s*[.,]?\s*$/, "");
      return { body: visible, spans: citedSpans(visible, item) };
    }
    const s = citedSpans(text, item);
    if (hiddenAt) s.push({ start: hiddenAt[0], end: hiddenAt[1], kind: "hidden" });
    return { body: text, spans: s };
  }, [item, hidden, showHidden, text]);

  const subline = d ? (d.blockedByGuard ? "SERV PROMPT GUARD" : `POLICY V${d.policyVersion} · ${stampDate(item.invoice.receivedAt)}`) : undefined;

  return (
    <article aria-label={`Invoice ${item.invoice.source}`} className="relative mx-auto w-full max-w-[760px] pt-6">
      {/* The paper jolts as a fresh stamp hits it. */}
      <motion.div
        key={fresh ? `thud-${d?.decidedAt}` : "still"}
        className="relative rounded-[3px] bg-paper shadow-[var(--shadow-paper)]"
        initial={false}
        animate={fresh && !reduce ? { y: [0, 0, 4, 0], rotate: [0, 0, 0.35, 0] } : undefined}
        transition={{ duration: 0.34, times: [0, 0.5, 0.7, 1], ease: "easeOut" }}
      >
        <BinderClip />
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-7 pb-3 pt-7 font-type text-xs text-ink-2 sm:px-10">
          <span className="rounded-[2px] bg-ink px-1.5 py-0.5 font-sans text-[0.65rem] font-black tracking-[0.1em] text-paper">{kindOf(item.invoice.source).toUpperCase()}</span>
          <span className="truncate">{item.invoice.source}</span>
          <span className="ml-auto">Received {stampDate(item.invoice.receivedAt)}</span>
        </header>

        <div className="px-7 pb-10 pt-7 sm:px-10">
          <pre className="max-w-[64ch] whitespace-pre-wrap break-words font-type text-[0.95rem] leading-[1.75] text-ink">{render(body, spans, activeNote)}</pre>

          {hidden ? (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                aria-pressed={showHidden}
                className="press rounded-[3px] bg-block px-4 py-2 text-sm font-black text-paper hover:brightness-110"
              >
                {showHidden ? "Hide the invisible text" : "Reveal what the model was fed"}
              </button>
              {showHidden ? (
                <span className="font-hand text-xl leading-tight text-block">
                  {kindOf(item.invoice.source) === "Photo" ? "Faint type in the photo. You can barely see it; a model reads it." : "1pt white type. You can't see it; a model reads it."}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {d ? (
          <div className="absolute right-5 top-16 sm:right-10 sm:top-[4.5rem]">
            <Stamp key={`${item.invoice.id}-${d.decidedAt}`} verdict={d.finalVerdict} subline={subline} fresh={fresh} />
          </div>
        ) : null}
      </motion.div>

      {item.paid ? (
        <a
          href={item.paid.txHash ? `https://sepolia.basescan.org/tx/${item.paid.txHash}` : undefined}
          target="_blank"
          rel="noreferrer"
          className="press mx-8 flex w-fit items-center gap-3 rounded-b-[3px] bg-paper-2 px-4 py-2 font-type text-xs text-ink sm:mx-10"
        >
          <span className="font-sans font-black tracking-[0.1em] text-pay">PAID</span>
          <span>{item.paid.settledUsdc} test USDC</span>
          {item.paid.txHash ? <span className="underline underline-offset-2">{shortHash(item.paid.txHash)} ↗</span> : null}
        </a>
      ) : null}
    </article>
  );
}

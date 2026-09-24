"use client";

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
          <mark key={i} className="rounded bg-card-block px-1 text-block">
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
    <svg aria-hidden viewBox="0 0 96 40" className="absolute -top-5 left-1/2 h-10 w-24 -translate-x-1/2 drop-shadow-[0_3px_2px_oklch(0.12_0.1_274/0.45)]">
      <path d="M20 22 L20 6 Q20 2 26 2 L70 2 Q76 2 76 6 L76 22" fill="none" stroke="oklch(0.78 0.01 274)" strokeWidth="3.5" />
      <rect x="8" y="18" width="80" height="20" rx="3" fill="oklch(0.2 0.02 274)" />
      <rect x="8" y="18" width="80" height="4" rx="2" fill="oklch(0.34 0.02 274)" />
    </svg>
  );
}

export function InvoiceSheet({ item, fresh, activeNote }: { item: DeskItem; fresh: boolean; activeNote: number | null }) {
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
      <div className="relative rounded-[4px] bg-sheet shadow-[var(--shadow-sheet)]">
        <BinderClip />
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-7 pb-3 pt-7 font-type text-xs text-ink-2 sm:px-10">
          <span className="rounded bg-ink px-1.5 py-0.5 font-sans text-[0.65rem] font-black tracking-[0.1em] text-sheet">{kindOf(item.invoice.source).toUpperCase()}</span>
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
                className="press rounded-xl bg-block px-4 py-2 text-sm font-bold text-sheet shadow-[var(--shadow-card)] hover:brightness-110"
              >
                {showHidden ? "Hide the invisible text" : "Reveal what the model was fed"}
              </button>
              {showHidden ? <span className="font-hand text-xl leading-tight text-block">1pt white type. You can&apos;t see it; a model reads it.</span> : null}
            </div>
          ) : null}
        </div>

        {d ? (
          <div className="absolute right-5 top-16 sm:right-10 sm:top-[4.5rem]">
            <Stamp key={`${item.invoice.id}-${d.decidedAt}`} verdict={d.finalVerdict} subline={subline} fresh={fresh} />
          </div>
        ) : null}
      </div>

      {item.paid ? (
        <a
          href={item.paid.txHash ? `https://sepolia.basescan.org/tx/${item.paid.txHash}` : undefined}
          target="_blank"
          rel="noreferrer"
          className="press mx-8 flex w-fit items-center gap-3 rounded-b-lg bg-card-pay px-4 py-2 font-type text-xs text-ink shadow-[var(--shadow-card)] hover:brightness-105 sm:mx-10"
        >
          <span className="font-sans font-black tracking-[0.1em] text-pay">PAID</span>
          <span>{item.paid.settledUsdc} test USDC</span>
          {item.paid.txHash ? <span className="underline underline-offset-2">{shortHash(item.paid.txHash)} ↗</span> : null}
        </a>
      ) : null}
    </article>
  );
}

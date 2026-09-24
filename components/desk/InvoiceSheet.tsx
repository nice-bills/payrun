"use client";

import { useMemo, useState } from "react";
import { Stamp } from "@/components/Stamp";
import type { DeskItem } from "@/lib/data";
import { locateQuote, shortHash, stampDate } from "@/lib/format";
import { kindOf } from "./InboxTray";

type Span = { start: number; end: number; kind: "evidence" | "hidden"; note?: number };

/** Evidence the reviewer cited, located in the invoice text and numbered to match the margin notes. */
export function citedSpans(item: DeskItem): Span[] {
  const text = item.invoice.rawText;
  const spans: Span[] = [];
  item.decision?.judgment?.reasons.forEach((r, i) => {
    const at = locateQuote(text, r.evidenceQuote);
    if (at && !spans.some((s) => s.start < at[1] && at[0] < s.end)) spans.push({ start: at[0], end: at[1], kind: "evidence", note: i + 1 });
  });
  return spans;
}

function render(text: string, spans: Span[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((s, i) => {
    if (s.start > cursor) out.push(text.slice(cursor, s.start));
    const piece = text.slice(s.start, s.end);
    out.push(
      s.kind === "hidden" ? (
        <mark key={i} className="rounded-sm bg-block-wash px-0.5 text-block outline outline-1 outline-block/40">
          {piece}
        </mark>
      ) : (
        <mark key={i} className="evidence text-ink">
          {piece}
          <sup className="ml-0.5 font-sans text-[0.65rem] font-bold text-pen">{s.note}</sup>
        </mark>
      ),
    );
    cursor = s.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function InvoiceSheet({ item, fresh }: { item: DeskItem; fresh: boolean }) {
  const [showHidden, setShowHidden] = useState(false);
  const d = item.decision;
  const hidden = item.invoice.hiddenText ?? null;
  const text = item.invoice.rawText;

  const { body, spans } = useMemo(() => {
    const hiddenAt = hidden ? locateQuote(text, hidden) : null;
    if (hiddenAt && !showHidden) {
      // What a person sees: the file without the invisible text.
      const visible = (text.slice(0, hiddenAt[0]) + text.slice(hiddenAt[1])).trimEnd();
      return { body: visible, spans: citedSpans({ ...item, invoice: { ...item.invoice, rawText: visible } }) };
    }
    const s = citedSpans(item);
    if (hiddenAt) s.push({ start: hiddenAt[0], end: hiddenAt[1], kind: "hidden" });
    return { body: text, spans: s };
  }, [item, hidden, showHidden, text]);

  const subline = d
    ? d.blockedByGuard
      ? "SERV PROMPT GUARD"
      : `POLICY V${d.policyVersion} · ${stampDate(item.invoice.receivedAt)}`
    : undefined;

  return (
    <article aria-label={`Invoice ${item.invoice.source}`} className="relative">
      <div className="relative rounded-[3px] bg-sheet shadow-[var(--shadow-sheet)]">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-6 py-3 font-type text-xs text-ink-2 sm:px-8">
          <span className="rounded border border-rule px-1.5 py-0.5 text-ink">{kindOf(item.invoice.source)}</span>
          <span className="truncate">{item.invoice.source}</span>
          <span className="ml-auto">Received {stampDate(item.invoice.receivedAt)}</span>
        </header>

        <div className="grain rounded-b-[3px] px-6 pb-10 pt-8 sm:px-8">
          <pre className="max-w-[68ch] whitespace-pre-wrap break-words font-type text-[0.9rem] leading-[1.7] text-ink">{render(body, spans)}</pre>

          {hidden ? (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              aria-pressed={showHidden}
              className="press mt-6 rounded-md border border-block/40 bg-block-wash px-3 py-1.5 text-sm font-medium text-block hover:border-block"
            >
              {showHidden ? "Hide the invisible text" : "Show what the model was fed"}
            </button>
          ) : null}
          {hidden && showHidden ? (
            <p className="mt-2 font-hand text-lg text-block">↑ set in 1pt white type: invisible on the page, readable by a model</p>
          ) : null}
        </div>

        {d ? (
          <div className="absolute right-4 top-12 sm:right-8 sm:top-14">
            <Stamp key={`${item.invoice.id}-${d.decidedAt}`} verdict={d.finalVerdict} subline={subline} fresh={fresh} />
          </div>
        ) : null}
      </div>

      {item.paid ? (
        <a
          href={item.paid.txHash ? `https://sepolia.basescan.org/tx/${item.paid.txHash}` : undefined}
          target="_blank"
          rel="noreferrer"
          className="mx-6 -mt-1 flex w-fit items-center gap-3 rounded-b-md border border-t-0 border-rule bg-sheet px-4 py-2 font-type text-xs text-ink-2 shadow-[var(--shadow-slip)] hover:text-ink sm:mx-8"
        >
          <span className="font-bold text-pay">PAID</span>
          <span>{item.paid.settledUsdc} test USDC</span>
          {item.paid.txHash ? <span className="underline decoration-rule underline-offset-2">{shortHash(item.paid.txHash)} ↗</span> : null}
        </a>
      ) : null}
    </article>
  );
}

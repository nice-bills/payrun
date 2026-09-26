"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pin } from "@/components/Pin";
import type { DeskItem } from "@/lib/data";
import { usdc, VERDICT } from "@/lib/format";
import type { Verdict } from "@/src/core/types";

export function whoFor(item: DeskItem, names: Map<string, string>): string {
  const d = item.decision;
  if (d?.blockedByGuard) return "Unknown sender";
  return (d?.contractorId && names.get(d.contractorId)) || d?.fields?.contractorName || item.invoice.source;
}

const KIND: Record<string, string> = { pdf: "PDF", eml: "Email", txt: "Text", md: "Text", png: "Photo", jpg: "Photo", jpeg: "Photo", webp: "Photo" };
export const kindOf = (source: string) => KIND[source.split(".").pop()?.toLowerCase() ?? ""] ?? "File";

const INK: Record<Verdict, string> = { PAY: "text-pay", HOLD: "text-hold", BLOCK: "text-block" };

function Card({
  item,
  names,
  selected,
  reviewing,
  tilt,
  onSelect,
  copy,
}: {
  item: DeskItem;
  names: Map<string, string>;
  selected: boolean;
  reviewing: boolean;
  tilt: number;
  onSelect: () => void;
  copy: boolean;
}) {
  const v = item.decision?.finalVerdict ?? null;
  const f = item.decision?.fields;
  return (
    <button
      type="button"
      tabIndex={copy ? -1 : undefined}
      onClick={onSelect}
      style={{ rotate: selected ? "0deg" : `${tilt}deg` }}
      className={`relative flex w-full flex-col gap-1.5 rounded-[3px] bg-paper px-4 pb-3 pt-4 text-left shadow-[var(--shadow-card)] transition-[rotate,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
        selected ? "lg:translate-x-2" : ""
      }`}
    >
      <Pin verdict={v} className="absolute -top-3 left-1/2 -translate-x-1/2" />
      {/* The ring glides between cards when the selection moves: "where am I". */}
      {selected && !copy ? (
        <motion.span
          layoutId="inbox-ring"
          aria-hidden
          className="pointer-events-none absolute -inset-[4px] rounded-[5px] border-[3px] border-ink"
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        />
      ) : null}
      <span className="flex items-start justify-between gap-3">
        <span className="truncate text-[0.98rem] font-extrabold tracking-[-0.015em] text-ink">{whoFor(item, names)}</span>
        <span className="shrink-0 font-type text-[0.98rem] font-bold tabular-nums text-ink">{usdc(f?.totalUsdc)}</span>
      </span>
      <span className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-type text-ink-2">
          {kindOf(item.invoice.source)}
          {f?.invoiceNumber ? ` · ${f.invoiceNumber}` : ""}
        </span>
        {reviewing ? (
          <span className="shrink-0 font-hand text-lg leading-none text-pen">reading…</span>
        ) : v ? (
          <span aria-label={VERDICT[v].label} className={`shrink-0 font-sans text-[0.72rem] font-black tracking-[0.14em] ${INK[v]}`}>
            {VERDICT[v].word}
            {item.paid?.status === "sent" ? <span className="ml-1.5 text-ink">· PAID</span> : null}
          </span>
        ) : (
          <span className="shrink-0 text-[0.72rem] font-bold tracking-[0.12em] text-ink-3">NOT READ</span>
        )}
      </span>
    </button>
  );
}

/**
 * Narrow screens: a conveyor that runs on its own (paused on touch, hover or
 * focus) and glides to the card being read during a pile review.
 * Desktop: a vertical pinboard that keeps the selected card in view.
 */
export function InboxTray({
  items,
  names,
  selectedId,
  reviewingId,
  onSelect,
}: {
  items: DeskItem[];
  names: Map<string, string>;
  selectedId: string | null;
  reviewingId: string | null;
  onSelect: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const [touched, setTouched] = useState(false);
  const [trackX, setTrackX] = useState<number | null>(null);

  // During a pile review, stop the conveyor and bring the card being read to the front.
  useLayoutEffect(() => {
    const el = reviewingId ? listRef.current?.querySelector<HTMLElement>(`[data-card="${reviewingId}"]`) : null;
    setTrackX(el ? Math.max(0, el.offsetLeft - 16) : null);
  }, [reviewingId]);

  // Desktop: keep the selected card on screen as the selection moves.
  useEffect(() => {
    const el = selectedId ? listRef.current?.querySelector<HTMLElement>(`[data-card="${selectedId}"]`) : null;
    if (el && window.matchMedia("(min-width: 1024px)").matches) el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selectedId, reduce]);

  const tracking = trackX !== null;
  const conveyorOn = !reduce && !touched && !tracking;

  return (
    <div
      className="conveyor-host -mx-4 overflow-hidden sm:-mx-6 lg:mx-0 lg:overflow-visible"
      data-paused={!conveyorOn}
      onPointerDown={() => setTouched(true)}
    >
      <ul
        ref={listRef}
        role="listbox"
        aria-label="Invoices this month"
        className={`flex w-max gap-4 px-4 pb-4 pt-4 sm:px-6 lg:w-auto lg:flex-col lg:gap-5 lg:px-0 lg:pr-3 lg:[animation:none] ${conveyorOn ? "conveyor" : ""}`}
        style={{
          ["--conveyor-duration" as string]: `${Math.max(30, items.length * 5)}s`,
          transform: tracking ? `translateX(-${trackX}px)` : undefined,
          transition: tracking ? "transform 450ms cubic-bezier(0.23, 1, 0.32, 1)" : undefined,
        }}
      >
        {[false, true].map((copy) =>
          items.map((item, n) => (
            <motion.li
              key={`${copy ? "copy-" : ""}${item.invoice.id}`}
              data-card={copy ? undefined : item.invoice.id}
              role={copy ? "presentation" : "option"}
              aria-selected={copy ? undefined : item.invoice.id === selectedId}
              aria-hidden={copy || undefined}
              inert={copy || undefined}
              // The second set exists only so the conveyor loops without a gap.
              className={`w-[252px] shrink-0 lg:w-auto ${copy ? "lg:hidden" : ""} ${copy && !conveyorOn ? "hidden" : ""}`}
              initial={reduce || copy ? false : { opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(n, 10) * 0.035, ease: [0.23, 1, 0.32, 1] }}
            >
              <Card
                item={item}
                names={names}
                copy={copy}
                selected={item.invoice.id === selectedId}
                reviewing={item.invoice.id === reviewingId}
                tilt={n % 3 === 0 ? -0.7 : n % 3 === 1 ? 0.5 : -0.2}
                onSelect={() => onSelect(item.invoice.id)}
              />
            </motion.li>
          )),
        )}
      </ul>
    </div>
  );
}

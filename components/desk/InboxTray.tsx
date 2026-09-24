"use client";

import { motion } from "motion/react";
import type { DeskItem } from "@/lib/data";
import { usdc, VERDICT } from "@/lib/format";
import type { Verdict } from "@/src/core/types";

export function whoFor(item: DeskItem, names: Map<string, string>): string {
  const d = item.decision;
  if (d?.blockedByGuard) return "Unknown sender";
  return (d?.contractorId && names.get(d.contractorId)) || d?.fields?.contractorName || item.invoice.source;
}

const KIND: Record<string, string> = { pdf: "PDF", eml: "Email", txt: "Text", md: "Text" };
export const kindOf = (source: string) => KIND[source.split(".").pop()?.toLowerCase() ?? ""] ?? "File";

const CARD: Record<Verdict, string> = { PAY: "bg-card-pay", HOLD: "bg-card-hold", BLOCK: "bg-card-block" };
const INK: Record<Verdict, string> = { PAY: "text-pay", HOLD: "text-hold", BLOCK: "text-block" };

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
  return (
    <ul role="listbox" aria-label="Invoices this month" className="flex gap-2.5 pb-3 lg:flex-col lg:pb-6 lg:pr-1">
      {items.map((item) => {
        const selected = item.invoice.id === selectedId;
        const v = item.decision?.finalVerdict ?? null;
        const f = item.decision?.fields;
        const reviewing = item.invoice.id === reviewingId;
        return (
          <li key={item.invoice.id} role="option" aria-selected={selected} className="w-[244px] shrink-0 [scroll-snap-align:start] lg:w-auto">
            <button
              type="button"
              onClick={() => onSelect(item.invoice.id)}
              className={`relative flex w-full flex-col gap-1.5 rounded-xl px-4 pb-3 pt-3.5 text-left shadow-[var(--shadow-card)] transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 ${
                v ? CARD[v] : "bg-sheet"
              } ${selected ? "lg:translate-x-1.5" : ""}`}
            >
              {/* The selection ring glides between cards: "where am I". */}
              {selected ? (
                <motion.span
                  layoutId="inbox-ring"
                  aria-hidden
                  className="pointer-events-none absolute -inset-[3px] rounded-[15px] border-[3px] border-marker"
                  transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                />
              ) : null}
              <span className="flex items-start justify-between gap-3">
                <span className="truncate text-[0.95rem] font-bold tracking-[-0.01em] text-ink">{whoFor(item, names)}</span>
                <span className="shrink-0 font-type text-[0.95rem] font-bold tabular-nums text-ink">{usdc(f?.totalUsdc)}</span>
              </span>
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-type text-ink-2">
                  {kindOf(item.invoice.source)}
                  {f?.invoiceNumber ? ` · ${f.invoiceNumber}` : ""}
                </span>
                {reviewing ? (
                  <span className="shrink-0 font-hand text-base leading-none text-pen">reading…</span>
                ) : v ? (
                  <span aria-label={VERDICT[v].label} className={`shrink-0 font-sans text-[0.7rem] font-black tracking-[0.12em] ${INK[v]}`}>
                    {VERDICT[v].glyph} {VERDICT[v].word}
                    {item.paid?.status === "sent" ? " · PAID" : ""}
                  </span>
                ) : (
                  <span className="shrink-0 text-[0.7rem] font-semibold tracking-[0.1em] text-ink-3">NOT READ</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

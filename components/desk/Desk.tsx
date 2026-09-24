"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { reviewInvoice } from "@/app/actions";
import type { DeskItem } from "@/lib/data";
import type { Contractor } from "@/src/core/types";
import { InboxTray } from "./InboxTray";
import { InvoiceSheet } from "./InvoiceSheet";
import { MarginNotes } from "./MarginNotes";

export function Desk({ items: initial, contractors }: { items: DeskItem[]; contractors: Contractor[] }) {
  const [items, setItems] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.invoice.id ?? null);
  /** Decisions made in this session: only these stamps slam. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const names = useMemo(() => new Map(contractors.map((c) => [c.id, c.name])), [contractors]);

  useEffect(() => setItems(initial), [initial]);

  const index = items.findIndex((i) => i.invoice.id === selectedId);
  const item = items[index] ?? null;

  const move = useCallback(
    (delta: number) => {
      if (!items.length) return;
      const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
      setSelectedId(next.invoice.id);
      setError(null);
    },
    [items, index],
  );

  // j/k and arrow keys walk the inbox. No animation: this happens dozens of times.
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

  const review = () => {
    if (!item) return;
    const id = item.invoice.id;
    setError(null);
    startTransition(async () => {
      const r = await reviewInvoice(id);
      if (!r.ok) return setError(r.error);
      setItems((prev) => prev.map((x) => (x.invoice.id === id ? { ...x, decision: r.decision } : x)));
      setFresh((prev) => new Set(prev).add(`${id}-${r.decision.decidedAt}`));
    });
  };

  if (!item) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">The inbox is empty</h1>
        <p className="mt-2 text-ink-2">Drop this month&apos;s invoices into the inbox folder and run the ingest command to load them.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[272px_minmax(0,1fr)_300px] lg:gap-8 xl:grid-cols-[288px_minmax(0,1fr)_340px]">
      <InboxTray items={items} names={names} selectedId={selectedId} onSelect={(id) => (setSelectedId(id), setError(null))} />
      <main className="min-w-0">
        <InvoiceSheet key={item.invoice.id} item={item} fresh={!!item.decision && fresh.has(`${item.invoice.id}-${item.decision.decidedAt}`)} />
      </main>
      <MarginNotes item={item} reviewing={pending} error={error} onReview={review} />
    </div>
  );
}

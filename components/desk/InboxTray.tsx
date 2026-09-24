"use client";

import type { DeskItem } from "@/lib/data";
import { usdc, VERDICT } from "@/lib/format";
import type { Verdict } from "@/src/core/types";

export function whoFor(item: DeskItem, names: Map<string, string>): string {
  const d = item.decision;
  return (d?.contractorId && names.get(d.contractorId)) || d?.fields?.contractorName || item.invoice.source;
}

const KIND: Record<string, string> = { pdf: "PDF", eml: "Email", txt: "Text", md: "Text" };
export const kindOf = (source: string) => KIND[source.split(".").pop()?.toLowerCase() ?? ""] ?? "File";

function Mark({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <span className="grid size-6 place-items-center rounded border border-dashed border-ink-3 text-[0.65rem] text-ink-3">?</span>;
  const ink = { PAY: "text-pay border-pay", HOLD: "text-hold border-hold", BLOCK: "text-block border-block" }[verdict];
  return (
    <span aria-label={VERDICT[verdict].label} className={`grid size-6 place-items-center rounded border-[1.5px] text-[0.8rem] font-black ${ink}`}>
      {VERDICT[verdict].glyph}
    </span>
  );
}

export function InboxTray({
  items,
  names,
  selectedId,
  onSelect,
}: {
  items: DeskItem[];
  names: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const count = (v: Verdict) => items.filter((i) => i.decision?.finalVerdict === v).length;
  return (
    <section aria-label="Invoices" className="flex min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <h2 className="text-sm font-semibold text-ink">Inbox</h2>
        <p className="font-type text-xs text-ink-2">
          <span className="text-pay">{count("PAY")} pay</span> · <span className="text-hold">{count("HOLD")} hold</span> ·{" "}
          <span className="text-block">{count("BLOCK")} block</span>
        </p>
      </div>
      <ul role="listbox" aria-label="Invoices this month" className="flex flex-col gap-1.5 overflow-y-auto pb-4 lg:max-h-[calc(100dvh-9rem)]">
        {items.map((item) => {
          const selected = item.invoice.id === selectedId;
          const f = item.decision?.fields;
          return (
            <li key={item.invoice.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onSelect(item.invoice.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-[background-color,box-shadow] duration-150 ${
                  selected ? "bg-sheet shadow-[var(--shadow-lift)]" : "hover:bg-sheet/70"
                }`}
              >
                <Mark verdict={item.decision?.finalVerdict ?? null} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{whoFor(item, names)}</span>
                  <span className="block truncate font-type text-xs text-ink-2">
                    {kindOf(item.invoice.source)}
                    {f?.invoiceNumber ? ` · ${f.invoiceNumber}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-type text-sm tabular-nums text-ink">
                  {usdc(f?.totalUsdc)}
                  {item.paid?.status === "sent" ? <span className="ml-1 text-pay" aria-label="paid">✓</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

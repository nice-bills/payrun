"use client";

import type { DeskItem } from "@/lib/data";
import { VERDICT } from "@/lib/format";
import type { FindingCode } from "@/src/core/types";
import { citedSpans } from "./InvoiceSheet";

const CHECK: Record<FindingCode, string> = {
  UNKNOWN_CONTRACTOR: "Sender is not in the contractor book",
  WALLET_MISMATCH: "Wallet differs from the one on file",
  WALLET_CHANGE_REQUEST: "Asks to change payment details",
  ARITHMETIC_MISMATCH: "Numbers don't add up",
  OVER_DAY_CAP: "More days than the agreement allows",
  RATE_MISMATCH: "Day rate above the agreement",
  EXACT_DUPLICATE: "Same invoice number already on file",
  SAME_PERIOD_ALREADY_BILLED: "Same period already billed",
  MISSING_TOTAL: "No total on the invoice",
};

export function MarginNotes({
  item,
  reviewing,
  error,
  onReview,
}: {
  item: DeskItem;
  reviewing: boolean;
  error: string | null;
  onReview: () => void;
}) {
  const d = item.decision;
  const j = d?.judgment;
  const highlighted = new Set(citedSpans(item).map((s) => s.note));
  const reasons = (j?.reasons ?? []).map((r, i) => ({ ...r, n: i + 1 })).slice(0, 4);
  const serv = d?.calls.find((c) => c.mode === "serv");

  return (
    <aside aria-label="Reviewer notes" className="flex flex-col gap-5">
      {d ? (
        <h2 className="text-[1.35rem] font-bold leading-tight tracking-[-0.02em] text-ink">{VERDICT[d.finalVerdict].label}</h2>
      ) : (
        <h2 className="text-[1.35rem] font-bold leading-tight text-ink-2">Not reviewed yet</h2>
      )}

      {d?.blockedByGuard ? (
        <p className="font-hand text-[1.45rem] leading-snug text-pen">
          Hidden instruction inside the file. SERV&apos;s guard stopped it before the model read a word.
        </p>
      ) : null}

      {reasons.length ? (
        <ol className="flex flex-col gap-4">
          {reasons.map((r) => (
            <li key={r.n} className="group">
              <p className="font-hand text-[1.3rem] leading-snug text-pen">
                <span className="mr-1.5 font-bold">§{r.clause}</span>
                {highlighted.has(r.n) ? <sup className="mr-1 font-sans text-[0.65rem] font-bold">{r.n}</sup> : null}
                {r.finding}
              </p>
              {item.clauses[r.clause - 1] ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-2">
                  <span className="font-semibold text-ink">Clause {r.clause}:</span> {item.clauses[r.clause - 1]}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {j?.suspectedManipulation ? (
        <p className="font-hand text-[1.3rem] leading-snug text-block">Leans on the reviewer: urgency, authority or instructions.</p>
      ) : null}

      {d && d.overriddenBy.length ? (
        <p className="rounded-md bg-hold-wash px-3 py-2 text-sm text-ink">
          The model said <b>{j?.verdict}</b>. Code overruled it: {d.overriddenBy.map((c) => CHECK[c].toLowerCase()).join(", ")}.
        </p>
      ) : null}

      {d && d.findings.length ? (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-ink-2">Checked by code</h3>
          <ul className="flex flex-col gap-1 text-sm text-ink">
            {d.findings.map((f) => (
              <li key={f.code} className="flex gap-2">
                <span aria-hidden className={f.hard ? "text-block" : "text-hold"}>
                  {f.hard ? "■" : "▲"}
                </span>
                {CHECK[f.code]}
              </li>
            ))}
          </ul>
        </div>
      ) : d && !d.blockedByGuard ? (
        <p className="text-sm text-ink-2">
          <span className="text-pay">✓</span> Rate, cap, arithmetic, wallet and duplicates checked by code.
        </p>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 border-t border-rule pt-4">
        <button
          type="button"
          onClick={onReview}
          disabled={reviewing}
          className="press w-fit rounded-lg border border-violet/30 bg-sheet px-3 py-1.5 text-sm font-semibold text-violet hover:border-violet disabled:cursor-progress disabled:opacity-60"
        >
          {reviewing ? "Reviewing…" : d ? "Review again" : "Review"}
        </button>
        {error ? <p role="alert" className="text-sm text-block">{error}</p> : null}
        {serv ? (
          <p className="font-type text-[0.7rem] leading-relaxed text-ink-3">
            SERV · {serv.model.replace(/-serv-.*/, "")}
            {serv.model.includes("-serv-") ? " · Kronos + Multipath" : ""} · policy v{d?.policyVersion} #{d?.policyHash.slice(0, 7)}
            {serv.replayed ? " · replayed" : ""}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

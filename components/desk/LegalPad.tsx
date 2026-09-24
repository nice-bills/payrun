"use client";

import { motion, useReducedMotion } from "motion/react";
import type { DeskItem } from "@/lib/data";
import { usdc } from "@/lib/format";
import type { FindingCode } from "@/src/core/types";
import { citedSpans } from "./InvoiceSheet";

const CHECK: Record<FindingCode, string> = {
  UNKNOWN_CONTRACTOR: "Not in the contractor book",
  WALLET_MISMATCH: "Wallet differs from the one on file",
  WALLET_CHANGE_REQUEST: "Asks to change payment details",
  ARITHMETIC_MISMATCH: "Numbers don't add up",
  OVER_DAY_CAP: "More days than the agreement allows",
  RATE_MISMATCH: "Day rate above the agreement",
  EXACT_DUPLICATE: "Invoice number already on file",
  SAME_PERIOD_ALREADY_BILLED: "Same period already on file",
  MISSING_TOTAL: "No total",
};

/** One sentence the eye lands on first: what to do with this invoice. */
function headline(item: DeskItem, who: string): { text: string; tone: string } {
  const d = item.decision;
  if (!d) return { text: "Not read yet", tone: "text-ink-3" };
  const first = who.split(" ")[0];
  if (d.blockedByGuard) return { text: "Blocked before reading", tone: "text-block" };
  if (d.finalVerdict === "PAY") return { text: item.paid?.status === "sent" ? `Paid ${first} ${usdc(d.payAmountUsdc)}` : `Pay ${first} ${usdc(d.payAmountUsdc)}`, tone: "text-ink" };
  if (d.finalVerdict === "HOLD") return { text: `Hold ${first}'s invoice`, tone: "text-ink" };
  return { text: "Don't pay this", tone: "text-ink" };
}

export function LegalPad({
  item,
  who,
  reviewing,
  error,
  onReview,
  onNote,
}: {
  item: DeskItem;
  who: string;
  reviewing: boolean;
  error: string | null;
  onReview: () => void;
  onNote: (n: number | null) => void;
}) {
  const d = item.decision;
  const j = d?.judgment;
  const linked = new Set(citedSpans(item.invoice.rawText, item).map((s) => s.note));
  const reasons = (j?.reasons ?? []).map((r, i) => ({ ...r, n: i + 1 })).slice(0, 4);
  const judge = d?.calls.filter((c) => c.mode === "serv").at(-1);
  const h = headline(item, who);
  const reduce = useReducedMotion();
  // Notes are written in, one after another, each time the invoice changes: "where to look".
  const write = (n: number) =>
    reduce
      ? {}
      : {
          initial: { clipPath: "inset(0 100% 0 0)" },
          animate: { clipPath: "inset(0 0% 0 0)" },
          transition: { duration: 0.32, delay: 0.12 + n * 0.09, ease: [0.23, 1, 0.32, 1] as const },
        };

  return (
    <aside key={item.invoice.id} aria-label="Reviewer's notes" className="legal-pad relative flex min-h-full flex-col rounded-t-[3px] pb-6 pl-14 pr-6 pt-6 shadow-[var(--shadow-paper)]">
      <h2 className={`relative w-fit text-[2.1rem] font-black leading-[1.02] tracking-[-0.04em] ${h.tone}`}>
        {h.text}
        <svg aria-hidden viewBox="0 0 200 12" className="absolute -bottom-2 left-0 h-3 w-full text-pen" preserveAspectRatio="none">
          <motion.path
            d="M3 8 C 50 3, 120 11, 197 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          />
        </svg>
      </h2>

      <div className="mt-7 flex flex-col gap-4">
        {d?.blockedByGuard ? (
          <motion.p {...write(0)} className="font-hand text-[1.55rem] leading-[1.25] text-pen">
            There&apos;s an instruction hidden inside this file. SERV&apos;s guard stopped it before the model read a word.
          </motion.p>
        ) : null}

        {reasons.map((r, idx) => (
          <motion.div
            key={r.n}
            {...write(idx)}
            className="group -mx-2 cursor-default rounded-[3px] px-2 py-1 transition-colors duration-150 hover:bg-paper/60"
            onMouseEnter={() => linked.has(r.n) && onNote(r.n)}
            onMouseLeave={() => onNote(null)}
          >
            <p className="font-hand text-[1.45rem] leading-[1.2] text-pen">
              <span className="mr-2 font-bold">
                §{r.clause}
                {linked.has(r.n) ? <sup className="ml-0.5 font-sans text-[0.7rem] font-black">{r.n}</sup> : null}
              </span>
              {r.finding}
            </p>
            {item.clauses[r.clause - 1] ? (
              <p className="mt-1 max-h-0 overflow-hidden text-xs leading-relaxed text-ink-2 opacity-0 transition-[max-height,opacity] duration-200 group-hover:max-h-24 group-hover:opacity-100">
                <b className="text-ink">Clause {r.clause}.</b> {item.clauses[r.clause - 1]}
              </p>
            ) : null}
          </motion.div>
        ))}

        {j?.suspectedManipulation ? (
          <motion.p {...write(reasons.length)} className="font-hand text-[1.45rem] leading-[1.2] text-block">
            Leans on the reviewer: urgency, authority or orders.
          </motion.p>
        ) : null}
      </div>

      {d && d.overriddenBy.length ? (
        <p className="mt-5 rounded-[2px] bg-paper px-3 py-2 text-sm text-ink shadow-[var(--shadow-press)]">
          Model said <b>{j?.verdict}</b>. Code overruled it.
        </p>
      ) : null}

      {d && d.findings.length ? (
        <ul className="mt-5 flex flex-wrap gap-2">
          {d.findings.map((f) => (
            <li
              key={f.code}
              className="rounded-[2px] bg-paper px-2 py-1 font-type text-xs text-ink shadow-[var(--shadow-press)]"
            >
              <b className={f.hard ? "text-block" : "text-hold"}>{f.hard ? "RULE" : "NOTE"}</b> {CHECK[f.code]}
            </li>
          ))}
        </ul>
      ) : d && !d.blockedByGuard ? (
        <p className="mt-5 font-type text-xs text-ink-2">Checked by code: rate, cap, sums, wallet, duplicates. Nothing found.</p>
      ) : null}

      <div className="mt-auto flex items-end justify-between gap-3 pt-8">
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onReview}
            disabled={reviewing}
            className="press w-fit rounded-[3px] bg-ink px-4 py-2 text-sm font-black text-paper hover:bg-band disabled:cursor-progress disabled:opacity-70"
          >
            {reviewing ? "Reading…" : d ? "Read it again" : "Read it"}
          </button>
          {error ? <p role="alert" className="text-sm font-semibold text-block">{error}</p> : null}
        </div>
        {judge ? (
          <p className="text-right font-type text-[0.68rem] leading-relaxed text-ink-2">
            SERV · {judge.model.replace(/-serv-.*/, "")}
            {judge.model.includes("-serv-") ? " · Kronos + Multipath" : ""}
            <br />
            policy v{d?.policyVersion} #{d?.policyHash.slice(0, 7)}
            {judge.replayed ? " · replayed" : ""}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

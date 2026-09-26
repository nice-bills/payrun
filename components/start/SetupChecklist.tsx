"use client";

import { motion } from "motion/react";
import Link from "next/link";

export interface SetupStep {
  title: string;
  why: string;
  done: boolean;
  status: string;
  href: string;
  cta: string;
}

/** Setup as a checklist on the board: a real order, so it is numbered, and the next step is the one that stands out. */
export function SetupChecklist({ steps, demo }: { steps: SetupStep[]; demo: boolean }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-[860px] px-4 pb-16 pt-8 sm:px-8">
        <p className="font-type text-sm text-ink">Get started</p>
        <h1 className="mt-2 text-[2.6rem] font-black leading-none tracking-[-0.045em] text-ink">
          {next === -1 ? "You're set up." : "Seven steps to your first pay run."}
        </h1>
        <p className="mt-3 max-w-[60ch] text-ink">
          {next === -1
            ? "Every step is done. New invoices wait on the desk for the next run."
            : `${done} of ${steps.length} done. Each step reads the real state of your company, so it ticks itself off.`}
        </p>
        {demo ? <p className="mt-2 font-hand text-xl text-pen">This is the read-only demo, so the steps show the demo company.</p> : null}

        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
          <motion.div className="h-full bg-pay" initial={{ width: 0 }} animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ duration: 0.9, delay: 0.2, ease: [0.23, 1, 0.32, 1] }} />
        </div>

        <ol className="mt-8 flex flex-col gap-3">
          {steps.map((s, i) => {
            const isNext = i === next;
            return (
              <li
                key={s.title}
                className={`grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 rounded-[3px] p-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center ${
                  isNext ? "bg-paper shadow-[var(--shadow-paper)]" : "bg-paper/80 shadow-[var(--shadow-press)]"
                }`}
              >
                <motion.span
                  aria-hidden
                  className={`grid size-10 place-items-center rounded-full font-type text-sm font-bold ${s.done ? "bg-pay text-paper" : isNext ? "bg-ink text-paper" : "bg-paper-2 text-ink-2"}`}
                  initial={s.done ? { scale: 0, rotate: -90 } : false}
                  animate={
                    isNext
                      ? { scale: 1, boxShadow: ["0 0 0 0 oklch(0.9 0.17 102 / 0.9)", "0 0 0 10px oklch(0.9 0.17 102 / 0)"] }
                      : { scale: 1, rotate: 0 }
                  }
                  transition={isNext ? { boxShadow: { duration: 1.6, repeat: Infinity, ease: "easeOut" } } : { duration: 0.35, delay: 0.15 + i * 0.08, ease: [0.23, 1, 0.32, 1] }}
                >
                  {s.done ? "✓" : i + 1}
                </motion.span>
                <div className="min-w-0">
                  <p className="font-black tracking-[-0.02em] text-ink">
                    <span className="sr-only">{s.done ? "Done: " : isNext ? "Next: " : "To do: "}</span>
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-2">{s.why}</p>
                  <p className={`mt-1 font-type text-xs ${s.done ? "text-pay" : "text-ink"}`}>{s.status}</p>
                </div>
                <Link
                  href={s.href}
                  className={`col-start-2 w-fit rounded-[3px] px-4 py-2 text-sm font-black sm:col-start-3 ${
                    isNext ? "press bg-marker text-ink hover:bg-marker-press" : "text-ink underline decoration-2 underline-offset-4"
                  }`}
                >
                  {s.done ? "Open" : s.cta}
                </Link>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}

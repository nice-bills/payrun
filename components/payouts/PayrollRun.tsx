"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { jobStatus, runPayrollAgent } from "@/app/actions";
import { Stamp } from "@/components/Stamp";
import { shortHash, usdc } from "@/lib/format";
import type { AgentStep, StepActor } from "@/src/core/agent";
import type { PayrollEvent, PayrollReport } from "@/src/core/payroll";
import type { Verdict } from "@/src/core/types";

export interface OpenRow {
  invoiceId: string;
  name: string;
  amountUsdc: number | null;
}

interface Sheet {
  invoiceId: string;
  name: string;
  steps: AgentStep[];
  verdict: Verdict | null;
}

/** Who acted, as a chip. SERV decides; Payrun checks; AgentKit reaches the chain; Coinbase's signer has the last word. */
const ACTOR: Record<StepActor, { label: string; cls: string }> = {
  SERV: { label: "SERV", cls: "bg-band text-on-band" },
  Payrun: { label: "Payrun", cls: "bg-paper-2 text-ink ring-1 ring-inset ring-ink-3" },
  AgentKit: { label: "AgentKit", cls: "bg-manila text-ink" },
  Coinbase: { label: "Signer", cls: "bg-ink text-paper" },
};

function apply(sheets: Sheet[], e: PayrollEvent): Sheet[] {
  if (e.type === "start") return sheets.some((s) => s.invoiceId === e.invoiceId) ? sheets : [...sheets, { invoiceId: e.invoiceId, name: e.name, steps: [], verdict: null }];
  return sheets.map((s) =>
    s.invoiceId !== e.invoiceId ? s : e.type === "step" ? { ...s, steps: [...s.steps, e.step] } : { ...s, name: e.name, verdict: e.verdict as Verdict },
  );
}

export function PayrollRun({ open, scale }: { open: OpenRow[]; scale: number }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayed, setReplayed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const playRecording = (r: PayrollReport) => {
    setReplayed(true);
    const events: PayrollEvent[] = r.runs.flatMap((run) => [
      { type: "start", invoiceId: run.invoiceId, name: run.name } as PayrollEvent,
      ...run.steps.map((step) => ({ type: "step", invoiceId: run.invoiceId, name: run.name, step }) as PayrollEvent),
      { type: "done", invoiceId: run.invoiceId, name: run.name, verdict: run.verdict } as PayrollEvent,
    ]);
    events.forEach((e, n) => timers.current.push(setTimeout(() => setSheets((s) => apply(s, e)), (n + 1) * (reduce ? 60 : 380))));
    timers.current.push(setTimeout(() => setRunning(false), (events.length + 1) * (reduce ? 60 : 380)));
  };

  const start = async () => {
    setError(null);
    setSheets([]);
    setRunning(true);
    const r = await runPayrollAgent();
    if (!r.ok) {
      setRunning(false);
      return setError(r.error);
    }
    if ("replay" in r.value) return playRecording(r.value.replay);
    const id = r.value.jobId;
    let seen = 0;
    const poll = async () => {
      const j = await jobStatus(id);
      if (!j.ok) {
        setRunning(false);
        return setError(j.error);
      }
      const fresh = j.value.progress.slice(seen).map((l) => JSON.parse(l) as PayrollEvent);
      seen = j.value.progress.length;
      if (fresh.length) setSheets((s) => fresh.reduce(apply, s));
      if (j.value.status === "running") return void timers.current.push(setTimeout(poll, 800));
      setRunning(false);
      if (j.value.error) setError(j.value.error);
      router.refresh();
    };
    void poll();
  };

  const openTotal = open.reduce((s, o) => s + (o.amountUsdc ?? 0), 0);

  return (
    <section aria-label="Pay run" className="mt-10">
      <h1 className="text-[2.6rem] font-black leading-none tracking-[-0.045em] text-ink">
        {open.length ? `${open.length} invoice${open.length === 1 ? "" : "s"} open` : "Nothing open"}
      </h1>
      <p className="mt-2 max-w-[60ch] text-ink">
        {open.length
          ? `The SERV agent reads each one against the live policy and pays, holds or blocks it itself, through Coinbase AgentKit. Testnet moves 1/${Math.round(1 / scale)} of each amount.`
          : "Every invoice on file is paid. New ones will wait here for the next run."}
      </p>

      {open.length || sheets.length ? (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={start}
            disabled={running || !open.length}
            className="press rounded-[3px] bg-marker px-6 py-3.5 text-lg font-black text-ink hover:bg-marker-press disabled:cursor-progress disabled:opacity-70"
          >
            {running ? "The agent is working…" : `Run payroll · ${open.length} open${openTotal ? ` · ${usdc(openTotal)} USDC` : ""}`}
          </button>
          {!sheets.length ? (
            <ul className="flex flex-wrap gap-2">
              {open.map((o) => (
                <li key={o.invoiceId} className="rounded-[2px] bg-paper px-2.5 py-1 text-sm font-bold text-ink shadow-[var(--shadow-press)]">
                  {o.name.split(" ")[0]}
                  {o.amountUsdc ? ` ${usdc(o.amountUsdc)}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-4 w-fit rounded-[2px] bg-paper px-3 py-2 font-bold text-block shadow-[var(--shadow-press)]">{error}</p> : null}
      {replayed ? <p className="mt-3 font-hand text-xl text-ink">A recorded run, replayed. Nothing moves in the demo.</p> : null}

      <ol className="mt-6 flex flex-col gap-4" aria-live="polite">
        <AnimatePresence initial={false}>
          {sheets.map((s) => (
            <motion.li
              key={s.invoiceId}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
              className="relative rounded-[3px] bg-paper p-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-lg font-black tracking-[-0.02em] text-ink">{s.name}</p>
                {s.verdict ? <Stamp verdict={s.verdict} size="sm" fresh /> : <span className="skeleton mt-1 inline-block h-6 w-16 rounded-[2px]" aria-hidden />}
              </div>
              <ol className="mt-2 flex flex-col gap-1.5">
                {s.steps.map((st, n) => (
                  <motion.li
                    key={n}
                    initial={reduce ? false : { opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="grid grid-cols-[4.6rem_minmax(0,1fr)] items-baseline gap-3 text-sm"
                  >
                    <span className={`rounded-[2px] px-1.5 py-0.5 text-center font-type text-[0.68rem] font-bold ${ACTOR[st.actor].cls}`}>{ACTOR[st.actor].label}</span>
                    <span className="min-w-0 text-ink">
                      <b className={st.ok === false ? "text-block" : st.ok ? "text-pay" : ""}>{st.title}</b>
                      <span className="text-ink-2"> · {st.detail}</span>
                      {st.txHash ? (
                        <a href={`https://sepolia.basescan.org/tx/${st.txHash}`} target="_blank" rel="noreferrer" className="ml-1 font-type text-xs text-ink underline">
                          {shortHash(st.txHash)}
                        </a>
                      ) : null}
                    </span>
                  </motion.li>
                ))}
              </ol>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

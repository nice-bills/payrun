"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { adoptReading, makeLive, replayDraft } from "@/app/actions";
import { Stamp } from "@/components/Stamp";
import { VERDICT } from "@/lib/format";
import type { GapKind, GapReport } from "@/src/core/gaps";
import type { ReplayReport } from "@/src/core/replay";
import type { PolicyVersion, Verdict } from "@/src/core/types";

const KIND: Record<GapKind, string> = {
  SILENT_CHOICE: "Read one way, silently",
  UNSTABLE: "Flips between runs",
  NOT_COVERED: "No clause decides it",
  NO_CLAUSE: "Verdict cites nothing",
};

function VerdictMark({ v }: { v: Verdict }) {
  const ink = { PAY: "text-pay", HOLD: "text-hold", BLOCK: "text-block" }[v];
  return <span className={`font-sans text-[0.7rem] font-black tracking-[0.12em] ${ink}`}>{VERDICT[v].glyph} {VERDICT[v].word}</span>;
}

export function PolicyBoard({
  policies,
  live,
  gaps,
  replay: initialReplay,
  names,
}: {
  policies: PolicyVersion[];
  live: PolicyVersion;
  gaps: GapReport | null;
  replay: ReplayReport | null;
  names: Record<string, string>;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const newest = policies.at(-1) ?? live;
  const [shown, setShown] = useState(newest.version);
  const [settled, setSettled] = useState<Record<number, number>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayReport | null>(initialReplay);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setShown(newest.version), [newest.version]);

  const version = policies.find((p) => p.version === shown) ?? live;
  const liveClauses = useMemo(() => new Set(live.clauses), [live]);
  const isDraft = version.version > live.version;
  const replayForShown = replay && replay.to.version === version.version ? replay : null;
  const open = (gaps?.results ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.gap.length > 0);

  const run = (label: string, fn: () => Promise<void>) => {
    setError(null);
    setWorking(label);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setWorking(null);
      }
    });
  };

  const adopt = (probeIndex: number, readingIndex: number) =>
    run(`adopt-${probeIndex}`, async () => {
      const r = await adoptReading(probeIndex, readingIndex);
      if (!r.ok) return setError(r.error);
      setSettled((s) => ({ ...s, [probeIndex]: r.value.version }));
      setShown(r.value.version);
      router.refresh();
    });

  const doReplay = () =>
    run("replay", async () => {
      const r = await replayDraft();
      if (!r.ok) return setError(r.error);
      setReplay(r.value);
    });

  const goLive = () =>
    run("live", async () => {
      const r = await makeLive(version.version);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <div className="mx-auto grid h-full max-w-[1520px] grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
      {/* The memo */}
      <main className="px-4 pb-12 pt-6 sm:px-8 lg:scroll-y lg:min-h-0">
        <div className="mx-auto max-w-[760px]">
          <div role="tablist" aria-label="Policy versions" className="flex gap-1.5 pl-4">
            {policies.map((p) => {
              const selected = p.version === shown;
              return (
                <button
                  key={p.version}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setShown(p.version)}
                  className={`rounded-t-lg px-4 pb-2 pt-2.5 font-type text-xs font-bold transition-colors duration-150 ${
                    selected ? "bg-sheet text-ink" : "bg-desk-line/70 text-on-desk-2 hover:text-on-desk"
                  }`}
                >
                  v{p.version} {p.version === live.version ? "· live" : p.version > live.version ? "· draft" : ""}
                </button>
              );
            })}
          </div>

          <motion.article
            key={version.version}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="relative rounded-[4px] bg-sheet px-7 pb-10 pt-8 shadow-[var(--shadow-sheet)] sm:px-12"
          >
            <div className="absolute right-6 top-6 sm:right-10">
              <span
                className="stamp inline-block rounded-[6px] px-4 py-2 font-sans text-2xl font-black tracking-[0.08em]"
                style={{ ["--stamp-ink" as string]: isDraft ? "var(--color-hold)" : version.version === live.version ? "var(--color-violet)" : "var(--color-ink-3)", rotate: "-6deg" }}
              >
                {version.version === live.version ? "LIVE" : isDraft ? "DRAFT" : "OLD"}
              </span>
            </div>
            <p className="font-sans text-4xl font-black tracking-[-0.04em] text-ink">Memo</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-type text-sm text-ink-2">
              <dt>To</dt>
              <dd className="text-ink">Accounts payable (Payrun)</dd>
              <dt>From</dt>
              <dd className="text-ink">Kofi Tetteh, CEO</dd>
              <dt>Re</dt>
              <dd className="text-ink">How we pay contractors</dd>
              <dt>Version</dt>
              <dd className="text-ink">
                v{version.version} · #{version.hash.slice(0, 7)}
              </dd>
            </dl>
            <hr className="my-6 border-rule" />
            <ol className="flex flex-col gap-3.5">
              {version.clauses.map((c, i) => {
                const added = !liveClauses.has(c) && version.version !== live.version;
                return (
                  <li key={i} className="grid grid-cols-[2rem_1fr] font-type text-[0.95rem] leading-[1.65] text-ink">
                    <span className="font-bold">{i + 1}.</span>
                    <span>
                      <span className={added ? "evidence" : undefined}>{c}</span>
                      {added ? <span className="ml-2 font-hand text-lg text-pen">new</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>

            {isDraft ? (
              <div className="mt-8 rounded-xl bg-desk px-5 py-4 text-on-desk">
                {replayForShown ? (
                  <>
                    <p className="text-lg font-black tracking-[-0.02em]">
                      {replayForShown.flips.length === 0
                        ? `No past decision changes under v${version.version}.`
                        : `${replayForShown.flips.length} of ${replayForShown.replayed} past decisions change under v${version.version}.`}
                    </p>
                    {replayForShown.flips.length ? (
                      <ul className="mt-3 flex flex-col gap-2">
                        {replayForShown.flips.map((f) => (
                          <li key={f.invoiceId} className="flex flex-wrap items-center gap-3 rounded-lg bg-sheet px-3 py-2 text-ink">
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">
                              {(f.after.contractorId && names[f.after.contractorId]) || f.invoiceId}
                            </span>
                            <VerdictMark v={f.before} />
                            <span aria-hidden className="text-ink-3">→</span>
                            <VerdictMark v={f.after.finalVerdict} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <button
                      type="button"
                      onClick={goLive}
                      disabled={!!working}
                      className="press mt-4 rounded-xl bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:opacity-70"
                    >
                      {working === "live" ? "Switching…" : `Make v${version.version} live`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-black tracking-[-0.02em]">Before this goes live</p>
                    <p className="mt-1 text-sm text-on-desk-2">Re-read this month&apos;s invoices under v{version.version} and see which verdicts would change.</p>
                    <button
                      type="button"
                      onClick={doReplay}
                      disabled={!!working}
                      className="press mt-3 rounded-xl bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:cursor-progress disabled:opacity-70"
                    >
                      {working === "replay" ? "Re-reading the month…" : `Replay under v${version.version}`}
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {error ? <p role="alert" className="mt-4 text-sm font-bold text-block">{error}</p> : null}
          </motion.article>
        </div>
      </main>

      {/* Holes in the policy, as sticky notes */}
      <aside aria-label="Holes in the policy" className="px-4 pb-12 pt-6 sm:px-8 lg:scroll-y lg:min-h-0 lg:pl-2">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-on-desk">{open.length} holes in v{gaps?.policyVersion ?? live.version}</h2>
        <p className="mt-1 max-w-[34ch] text-sm text-on-desk-2">SERV wrote invoices aimed at your wording. These are the cases it leaves to the reviewer&apos;s guess.</p>
        <ul className="mt-6 flex flex-col gap-6">
          {open.map(({ r, i }, n) => {
            const today = r.verdicts[0];
            const done = settled[i];
            return (
              <li
                key={i}
                className="rounded-md bg-note px-5 pb-5 pt-4 shadow-[var(--shadow-card)]"
                style={{ rotate: `${n % 2 ? 0.8 : -0.8}deg` }}
              >
                <p className="font-type text-[0.7rem] font-bold uppercase tracking-[0.12em] text-ink-2">{KIND[r.gap[0]]}</p>
                <h3 className="mt-1 text-lg font-black leading-snug tracking-[-0.02em] text-ink">{r.probe.title}</h3>
                <p className="mt-2 font-hand text-[1.3rem] leading-[1.2] text-ink">{r.probe.whyAmbiguous}</p>
                <p className="mt-3 text-sm text-ink-2">
                  Reviewer today: <VerdictMark v={today} />
                  {new Set(r.verdicts).size > 1 ? <span className="ml-1">(varies: {r.verdicts.join(" / ")})</span> : null}
                </p>
                {done ? (
                  <p className="mt-4 rounded-lg bg-sheet px-3 py-2 text-sm font-bold text-pay">✓ Settled in v{done}</p>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    <p className="text-xs font-bold text-ink-2">Which do you mean?</p>
                    {r.probe.readings.map((reading, k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => adopt(i, k)}
                        disabled={!!working}
                        className="press group flex flex-col gap-1 rounded-lg bg-sheet px-3 py-2.5 text-left shadow-[var(--shadow-card)] hover:ring-2 hover:ring-ink disabled:opacity-60"
                      >
                        <span className="flex items-center gap-2">
                          <VerdictMark v={reading.verdict} />
                          {reading.reading === r.chosenReading ? <span className="font-hand text-base leading-none text-pen">what happens today</span> : null}
                        </span>
                        <span className="text-sm leading-snug text-ink">{reading.reading}</span>
                      </button>
                    ))}
                    {working === `adopt-${i}` ? <p className="font-hand text-lg text-pen">writing the clause…</p> : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {!open.length ? (
          <div className="mt-8 flex items-center gap-4 text-on-desk">
            <Stamp verdict="PAY" size="sm" />
            <p className="text-sm">No open holes. Run the gap finder after changing the policy.</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

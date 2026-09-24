"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { adoptReading, findHoles, jobStatus, lintVersion, makeLive, replayDraft, saveDraft } from "@/app/actions";
import { Pin } from "@/components/Pin";
import { Stamp } from "@/components/Stamp";
import { VERDICT } from "@/lib/format";
import type { GapKind, GapReport } from "@/src/core/gaps";
import type { LintKind, LintReport } from "@/src/core/lint";
import type { ReplayReport } from "@/src/core/replay";
import type { PolicyVersion, Verdict } from "@/src/core/types";

const LINT: Record<LintKind, string> = {
  conflict: "Clashes with another clause",
  undefined_term: "Uses a word it never defines",
  ambiguous: "Reads two ways",
  missing_case: "Nothing decides this",
};

const KIND: Record<GapKind, string> = {
  SILENT_CHOICE: "Read one way, silently",
  UNSTABLE: "Flips between runs",
  NOT_COVERED: "No clause decides it",
  NO_CLAUSE: "Verdict cites nothing",
};

function VerdictMark({ v }: { v: Verdict }) {
  const ink = { PAY: "text-pay", HOLD: "text-hold", BLOCK: "text-block" }[v];
  return (
    <span className={`inline-flex items-center gap-1 font-sans text-[0.72rem] font-black tracking-[0.14em] ${ink}`}>
      <Pin verdict={v} className="size-4" />
      {VERDICT[v].word}
    </span>
  );
}

export function PolicyBoard({
  policies,
  live,
  gaps,
  replay: initialReplay,
  names,
  lints,
}: {
  policies: PolicyVersion[];
  live: PolicyVersion;
  gaps: GapReport | null;
  replay: ReplayReport | null;
  names: Record<string, string>;
  lints: Record<number, LintReport>;
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
  const [editing, setEditing] = useState<string[] | null>(null);
  const [holes, setHoles] = useState<{ id: string; progress: string[]; status: string } | null>(null);

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

  const startEdit = () => setEditing([...version.clauses]);

  /** Open the editor with SERV's suggested wording applied: replace the clause, or add a new one. */
  const useSuggestion = (clause: number | null, suggestion: string) => {
    const text = suggestion.replace(/^(add|replace with|change to|reword to)\s*:\s*/i, "").replace(/^["“”']+|["“”']+$/g, "").trim();
    const next = [...version.clauses];
    if (clause && next[clause - 1] !== undefined) next[clause - 1] = text;
    else next.push(text);
    setEditing(next);
  };

  const saveEdit = () =>
    run("save", async () => {
      if (!editing) return;
      const r = await saveDraft(editing);
      if (!r.ok) return setError(r.error);
      setEditing(null);
      setShown(r.value);
      router.refresh();
      // SERV reads the new wording straight away.
      setWorking("lint");
      const l = await lintVersion(r.value);
      if (!l.ok) setError(l.error);
      router.refresh();
    });

  const checkWording = () =>
    run("lint", async () => {
      const l = await lintVersion(version.version);
      if (!l.ok) return setError(l.error);
      router.refresh();
    });

  const holesFor = (v: number) =>
    run("holes", async () => {
      const r = await findHoles(v);
      if (!r.ok) return setError(r.error);
      setHoles({ id: r.value, progress: [], status: "running" });
      // Poll the background job so the page shows what SERV is doing.
      for (;;) {
        await new Promise((res) => setTimeout(res, 1500));
        const j = await jobStatus(r.value);
        if (!j.ok) return setError(j.error);
        setHoles({ id: r.value, progress: j.value.progress, status: j.value.status });
        if (j.value.status !== "running") {
          if (j.value.error) setError(j.value.error);
          setSettled({});
          router.refresh();
          return;
        }
      }
    });

  const lint = lints[version.version] ?? null;
  const issuesFor = (clause: number) => lint?.issues.filter((i) => i.clause === clause) ?? [];
  const openCases = lint?.issues.filter((i) => i.clause === null) ?? [];

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
                    selected ? "bg-paper text-ink" : "bg-cork-dark text-paper hover:bg-cork-deep"
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
            className="relative rounded-[4px] bg-paper px-7 pb-10 pt-8 shadow-[var(--shadow-paper)] sm:px-12"
          >
            <div className="absolute right-6 top-6 sm:right-10">
              <span
                className="stamp inline-block rounded-[6px] px-4 py-2 font-sans text-2xl font-black tracking-[0.08em]"
                style={{ ["--stamp-ink" as string]: isDraft ? "var(--color-hold)" : version.version === live.version ? "var(--color-ink)" : "var(--color-ink-3)", rotate: "-6deg" }}
              >
                {version.version === live.version ? "LIVE" : isDraft ? "DRAFT" : "OLD"}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <p className="font-sans text-4xl font-black tracking-[-0.04em] text-ink">Memo</p>
              {!editing ? (
                <button type="button" onClick={startEdit} disabled={!!working} className="press rounded-[3px] bg-ink px-3 py-1.5 text-sm font-black text-paper hover:bg-band">
                  Edit
                </button>
              ) : null}
            </div>
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
            {editing ? (
              <div>
                <ol className="flex flex-col gap-3">
                  {editing.map((c, i) => (
                    <li key={i} className="grid grid-cols-[2rem_1fr_auto] items-start gap-2 font-type text-[0.95rem] leading-[1.65] text-ink">
                      <span className="pt-2 font-bold">{i + 1}.</span>
                      <textarea
                        aria-label={`Clause ${i + 1}`}
                        value={c}
                        onChange={(e) => setEditing((prev) => prev!.map((x, k) => (k === i ? e.target.value : x)))}
                        className="min-h-[3.2em] w-full resize-none rounded-[2px] border-2 border-rule bg-paper px-2.5 py-1.5 leading-[1.6] outline-none [field-sizing:content] focus:border-ink"
                      />
                      <button
                        type="button"
                        aria-label={`Remove clause ${i + 1}`}
                        onClick={() => setEditing((prev) => prev!.filter((_, k) => k !== i))}
                        className="mt-1.5 rounded-[2px] px-2 py-1 font-sans text-xs font-bold text-block hover:bg-pin-block/10"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing((prev) => [...(prev ?? []), ""])}
                    className="rounded-[3px] border-2 border-dashed border-ink-3 px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
                  >
                    Add a clause
                  </button>
                  <span className="flex-1" />
                  <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm font-bold text-ink-2 hover:text-ink">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={!!working}
                    className="press rounded-[3px] bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:opacity-70"
                  >
                    {working === "save" ? "Saving…" : "Save as a draft"}
                  </button>
                </div>
              </div>
            ) : (
              <ol className="flex flex-col gap-3.5">
                {version.clauses.map((c, i) => {
                  const added = !liveClauses.has(c) && version.version !== live.version;
                  return (
                    <li key={i} className="grid grid-cols-[2rem_1fr] font-type text-[0.95rem] leading-[1.65] text-ink">
                      <span className="font-bold">{i + 1}.</span>
                      <span>
                        <span className={added ? "evidence" : undefined}>{c}</span>
                        {added ? <span className="ml-2 font-hand text-lg text-pen">new</span> : null}
                        {issuesFor(i + 1).map((issue, k) => (
                          <motion.span
                            key={k}
                            initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
                            animate={{ clipPath: "inset(0 0% 0 0)" }}
                            transition={{ duration: 0.35, delay: 0.1 + k * 0.1, ease: [0.23, 1, 0.32, 1] }}
                            className="mt-1.5 block font-hand text-[1.25rem] leading-[1.2] text-pen"
                          >
                            <b>{LINT[issue.kind]}.</b> {issue.note} <span className="text-ink-2">Try: {issue.suggestion}</span>
                            <button
                              type="button"
                              onClick={() => useSuggestion(issue.clause, issue.suggestion)}
                              className="ml-2 rounded-[2px] bg-ink px-2 py-0.5 align-middle font-sans text-[0.72rem] font-black text-paper hover:bg-band"
                            >
                              Use this wording
                            </button>
                          </motion.span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {!editing ? (
              <div className="mt-7 border-t border-dashed border-rule pt-5">
                {working === "lint" ? (
                  <p className="font-hand text-xl text-pen">SERV is compiling and reading the wording. A new policy takes about a minute the first time.</p>
                ) : lint ? (
                  <>
                    <p className="font-sans text-sm font-black text-ink">
                      {lint.issues.length ? `SERV flagged ${lint.issues.length} thing${lint.issues.length === 1 ? "" : "s"} in v${version.version}.` : `SERV found nothing to flag in v${version.version}.`}
                    </p>
                    {openCases.map((issue, k) => (
                      <p key={k} className="mt-2 font-hand text-[1.25rem] leading-[1.2] text-pen">
                        <b>{LINT[issue.kind]}.</b> {issue.note} <span className="text-ink-2">Try: {issue.suggestion}</span>
                        <button
                          type="button"
                          onClick={() => useSuggestion(null, issue.suggestion)}
                          className="ml-2 rounded-[2px] bg-ink px-2 py-0.5 align-middle font-sans text-[0.72rem] font-black text-paper hover:bg-band"
                        >
                          Add this clause
                        </button>
                      </p>
                    ))}
                  </>
                ) : (
                  <button type="button" onClick={checkWording} disabled={!!working} className="press rounded-[3px] bg-ink px-3.5 py-2 text-sm font-black text-paper hover:bg-band disabled:opacity-70">
                    Have SERV check the wording
                  </button>
                )}
              </div>
            ) : null}

            {isDraft ? (
              <div className="mt-8 rounded-[3px] bg-band px-5 py-4 text-on-band">
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
                          <li key={f.invoiceId} className="flex flex-wrap items-center gap-3 rounded-[3px] bg-paper px-3 py-2 text-ink">
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
                      className="press mt-4 rounded-[4px] bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:opacity-70"
                    >
                      {working === "live" ? "Switching…" : `Make v${version.version} live`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-black tracking-[-0.02em]">Before this goes live</p>
                    <p className="mt-1 text-sm text-on-band-2">Re-read this month&apos;s invoices under v{version.version} and see which verdicts would change.</p>
                    <button
                      type="button"
                      onClick={doReplay}
                      disabled={!!working}
                      className="press mt-3 rounded-[4px] bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:cursor-progress disabled:opacity-70"
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
        <h2 className="text-2xl font-black tracking-[-0.03em] text-ink">{open.length} holes in v{gaps?.policyVersion ?? live.version}</h2>
        <p className="mt-1 max-w-[36ch] text-sm text-ink">SERV writes invoices aimed at your wording and reads each one three times. These are the cases it leaves to the reviewer&apos;s guess.</p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => holesFor(version.version)}
            disabled={!!working}
            className="press w-fit rounded-[3px] bg-ink px-4 py-2 text-sm font-black text-paper hover:bg-band disabled:cursor-progress disabled:opacity-70"
          >
            {working === "holes" ? "SERV is probing…" : `Find holes in v${version.version}`}
          </button>
          {holes && holes.status === "running" ? (
            <ol className="rounded-[3px] bg-paper px-4 py-3 shadow-[var(--shadow-press)]">
              {holes.progress.slice(-4).map((line, k, arr) => (
                <motion.li
                  key={`${holes.progress.length - arr.length + k}`}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: k === arr.length - 1 ? 1 : 0.55, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="font-hand text-lg leading-tight text-pen"
                >
                  {line}
                </motion.li>
              ))}
              {!holes.progress.length ? <li className="font-hand text-lg text-pen">starting…</li> : null}
            </ol>
          ) : null}
        </div>
        <ul className="mt-6 flex flex-col gap-6">
          {open.map(({ r, i }, n) => {
            const today = r.verdicts[0];
            const done = settled[i];
            return (
              <li
                key={i}
                className="rounded-[3px] bg-note px-5 pb-5 pt-4 shadow-[var(--shadow-card)]"
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
                  <p className="mt-4 rounded-[3px] bg-paper px-3 py-2 text-sm font-bold text-pay">Settled in v{done}</p>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    <p className="text-xs font-bold text-ink-2">Which do you mean?</p>
                    {r.probe.readings.map((reading, k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => adopt(i, k)}
                        disabled={!!working}
                        className="press group flex flex-col gap-1 rounded-[3px] bg-paper px-3 py-2.5 text-left shadow-[var(--shadow-card)] hover:ring-2 hover:ring-ink disabled:opacity-60"
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
          <div className="mt-8 flex items-center gap-4 text-ink">
            <Stamp verdict="PAY" size="sm" />
            <p className="text-sm">No open holes. Run the gap finder after changing the policy.</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

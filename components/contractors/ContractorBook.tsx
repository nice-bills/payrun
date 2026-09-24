"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { attachWalletRules, readAgreementText, removeContractor, saveContractor } from "@/app/actions";
import { shortHash, usdc } from "@/lib/format";
import type { Contractor } from "@/src/core/types";

type Draft = Partial<Contractor> & { isNew?: boolean };

const SAMPLE = `From: Abena Owusu-Ansah <abena@ansah.studio>
To: Kofi Tetteh
Subject: Re: Motion design contract

Hi Kofi, confirming what we agreed on the call:
- Motion design for the product launch videos and in-app animations
- 420 USDC per day, no more than 8 days in any month
- Please pay to 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF (Base)
- You approved up to 150 USDC for a stock-music licence on 12 Sept.

Thanks! Abena`;

function Field({ label, children, missing }: { label: string; children: React.ReactNode; missing?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={`text-xs font-bold ${missing ? "text-block" : "text-ink-2"}`}>
        {label}
        {missing ? " · SERV couldn't find this" : ""}
      </span>
      {children}
    </label>
  );
}

const input = "w-full rounded-[2px] border-2 border-rule bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink";

function ContractorForm({ draft, missing = [], onDone, onCancel }: { draft: Draft; missing?: string[]; onDone: () => void; onCancel: () => void }) {
  const [c, setC] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Contractor>(k: K, v: Contractor[K]) => setC((p) => ({ ...p, [k]: v }));
  const miss = (k: string) => missing.includes(k) && !c[k as keyof Contractor];

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveContractor({ ...(c as Contractor), isNew: draft.isNew });
      if (!r.ok) return setError(r.error);
      onDone();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" missing={miss("name")}>
          <input className={input} value={c.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Email on file" missing={miss("email")}>
          <input className={input} value={c.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </div>
      <Field label="Wallet (Base)" missing={miss("wallet")}>
        <input className={`${input} font-type`} value={c.wallet ?? ""} onChange={(e) => set("wallet", e.target.value.trim() as `0x${string}`)} placeholder="0x…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day rate (USDC)" missing={miss("dayRateUsdc")}>
          <input className={`${input} font-type`} inputMode="decimal" value={c.dayRateUsdc ?? ""} onChange={(e) => set("dayRateUsdc", Number(e.target.value.replace(/[^0-9.]/g, "")) as never)} />
        </Field>
        <Field label="Days per month, at most" missing={miss("monthlyDayCap")}>
          <input className={`${input} font-type`} inputMode="numeric" value={c.monthlyDayCap ?? ""} onChange={(e) => set("monthlyDayCap", Number(e.target.value.replace(/[^0-9]/g, "")) as never)} />
        </Field>
      </div>
      <Field label="Scope of work" missing={miss("scope")}>
        <textarea className={`${input} resize-none [field-sizing:content]`} value={c.scope ?? ""} onChange={(e) => set("scope", e.target.value)} />
      </Field>
      {c.expenseApprovals?.length ? (
        <div className="text-sm text-ink">
          <p className="text-xs font-bold text-ink-2">Expenses approved in writing</p>
          <ul className="mt-1">
            {c.expenseApprovals.map((a, i) => (
              <li key={i} className="font-type text-xs">
                {a.description}, up to {a.maxUsdc} USDC{a.approvedOn ? `, ${a.approvedOn}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm font-bold text-block">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm font-bold text-ink-2 hover:text-ink">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={pending} className="press rounded-[3px] bg-ink px-4 py-2 text-sm font-black text-paper hover:bg-band disabled:opacity-70">
          {pending ? "Saving…" : draft.isNew ? "Add to the book" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function ContractorBook({ contractors, rulesCurrent, rulesAttachedAt }: { contractors: Contractor[]; rulesCurrent: boolean; rulesAttachedAt: string | null }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [editing, setEditing] = useState<string | null>(null);
  const [agreement, setAgreement] = useState("");
  const [draft, setDraft] = useState<{ c: Draft; missing: string[]; notes: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"read" | "attach" | null>(null);
  const [, start] = useTransition();

  const done = () => {
    setEditing(null);
    setDraft(null);
    router.refresh();
  };

  const read = () =>
    start(async () => {
      setError(null);
      setWorking("read");
      const r = await readAgreementText(agreement);
      setWorking(null);
      if (!r.ok) return setError(r.error);
      setDraft({ c: { ...r.value.contractor, isNew: true }, missing: r.value.missing, notes: r.value.notes });
    });

  const attach = () =>
    start(async () => {
      setError(null);
      setWorking("attach");
      const r = await attachWalletRules();
      setWorking(null);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      const r = await removeContractor(id);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <div className="mx-auto grid h-full max-w-[1520px] grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_440px] lg:overflow-hidden">
      <main className="px-4 pb-12 pt-6 sm:px-8 lg:scroll-y lg:min-h-0">
        <div className="mx-auto max-w-[900px]">
          <h1 className="text-[2.6rem] font-black leading-none tracking-[-0.045em] text-ink">Contractor book</h1>
          <p className="mt-2 max-w-[60ch] text-ink">
            {contractors.length} contractors. Payrun pays only these wallets, never more than a month at the agreed rate. The same limits live on your payroll wallet.
          </p>

          <div className={`mt-5 flex flex-wrap items-center gap-4 rounded-[3px] px-5 py-4 shadow-[var(--shadow-paper)] ${rulesCurrent ? "bg-paper" : "bg-band text-on-band"}`}>
            <p className="min-w-0 flex-1 text-sm">
              {rulesCurrent ? (
                <>
                  <b className="text-pay">Wallet rules match this book.</b>{" "}
                  <span className="text-ink-2">Attached {rulesAttachedAt ? new Date(rulesAttachedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}.</span>
                </>
              ) : (
                <>
                  <b>The wallet still enforces an older book.</b> <span className="text-on-band-2">Attach the new rules so Coinbase&apos;s signer knows about these changes.</span>
                </>
              )}
            </p>
            {!rulesCurrent ? (
              <button type="button" onClick={attach} disabled={!!working} className="press rounded-[3px] bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:opacity-70" style={{ boxShadow: "2px 3px 0 oklch(0.18 0.06 258)" }}>
                {working === "attach" ? "Attaching…" : "Attach the new rules"}
              </button>
            ) : null}
          </div>
          {error ? <p role="alert" className="mt-3 w-fit rounded-[2px] bg-paper px-3 py-1.5 text-sm font-bold text-block">{error}</p> : null}

          <ul className="mt-8 grid gap-x-6 gap-y-9 sm:grid-cols-2">
            {draft ? (
              <motion.li initial={reduce ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }} className="relative sm:col-span-2">
                <span className="absolute -top-6 left-4 rounded-t-[3px] bg-note px-4 pb-1 pt-1.5 text-sm font-black text-ink">New, read by SERV</span>
                <div className="rounded-[3px] bg-note p-5 shadow-[var(--shadow-paper)]">
                  {draft.notes ? <p className="mb-3 font-hand text-xl leading-snug text-pen">{draft.notes}</p> : null}
                  <ContractorForm draft={draft.c} missing={draft.missing} onDone={done} onCancel={() => setDraft(null)} />
                </div>
              </motion.li>
            ) : null}
            {contractors.map((c, n) => (
              <motion.li
                key={c.id}
                initial={reduce ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(n, 10) * 0.03, ease: [0.23, 1, 0.32, 1] }}
                className="relative"
              >
                {/* A manila folder: the tab carries the name. */}
                <span className="absolute -top-6 left-4 max-w-[70%] truncate rounded-t-[3px] bg-manila px-4 pb-1 pt-1.5 text-sm font-black text-ink">{c.name}</span>
                <div className="rounded-[3px] bg-manila p-5 shadow-[var(--shadow-paper)]">
                  {editing === c.id ? (
                    <ContractorForm draft={c} onDone={done} onCancel={() => setEditing(null)} />
                  ) : (
                    <>
                      <p className="font-type text-xs text-ink-2">{c.email}</p>
                      <p className="mt-3 flex items-baseline gap-2 text-ink">
                        <span className="text-2xl font-black tracking-[-0.03em]">{usdc(c.dayRateUsdc)}</span>
                        <span className="text-sm font-bold">USDC a day · up to {c.monthlyDayCap} days</span>
                      </p>
                      <p className="mt-2 text-sm leading-snug text-ink">{c.scope}</p>
                      {c.expenseApprovals?.length ? (
                        <p className="mt-2 font-type text-xs text-ink-2">
                          Approved: {c.expenseApprovals.map((a) => `${a.description} (≤ ${a.maxUsdc})`).join("; ")}
                        </p>
                      ) : null}
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-cork-dark pt-3">
                        <span className="font-type text-xs text-ink">{shortHash(c.wallet)}</span>
                        <span className="flex gap-1">
                          <button type="button" onClick={() => setEditing(c.id)} className="rounded-[2px] px-2.5 py-1 text-sm font-bold text-ink hover:bg-paper/60">
                            Edit
                          </button>
                          <button type="button" onClick={() => remove(c.id)} className="rounded-[2px] px-2.5 py-1 text-sm font-bold text-block hover:bg-paper/60">
                            Remove
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>
        </div>
      </main>

      <aside aria-label="Read an agreement" className="px-4 pb-12 pt-6 sm:px-8 lg:scroll-y lg:min-h-0 lg:pl-2">
        <div className="rounded-[3px] bg-paper p-6 shadow-[var(--shadow-paper)]">
          <h2 className="text-2xl font-black tracking-[-0.03em] text-ink">Read an agreement</h2>
          <p className="mt-1 text-sm text-ink-2">Paste the contract or the email that sets the terms. SERV fills in the card; you check it before anything is saved.</p>
          <textarea
            aria-label="Agreement text"
            value={agreement}
            onChange={(e) => setAgreement(e.target.value)}
            placeholder="Paste the agreement here"
            className="mt-4 min-h-[16rem] w-full resize-none rounded-[2px] border-2 border-rule bg-paper-2 p-3 font-type text-[0.82rem] leading-relaxed text-ink outline-none [field-sizing:content] focus:border-ink"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={read} disabled={!!working || !agreement.trim()} className="press rounded-[3px] bg-marker px-4 py-2 text-sm font-black text-ink hover:bg-marker-press disabled:opacity-60">
              {working === "read" ? "SERV is reading…" : "Read it with SERV"}
            </button>
            {!agreement ? (
              <button type="button" onClick={() => setAgreement(SAMPLE)} className="text-sm font-bold text-ink underline underline-offset-2">
                Use a sample email
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

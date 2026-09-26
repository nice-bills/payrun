"use server";

import { revalidatePath } from "next/cache";
import { decide, MODES } from "@/src/core/decide";
import { ServClient } from "@/src/core/serv";
import { warmKey, warmPolicy } from "@/src/core/warm";
import { DEMO_MESSAGE, dbPath, isDemo } from "@/lib/demo";
import { Store } from "@/src/core/store";
import { walletRulesFingerprint } from "@/lib/walletRules";
import type { Decision } from "@/src/core/types";

const store = () => new Store(dbPath(), { readOnly: isDemo() });
const demoRefusal = () => ({ ok: false as const, error: DEMO_MESSAGE });

export type ReviewResult = { ok: true; decision: Decision } | { ok: false; error: string };

/**
 * Re-decide one invoice under the current policy. With PAYRUN_SERV_CASSETTE=auto
 * an identical request is answered from the recording, so re-reviewing an
 * unchanged invoice costs nothing.
 */
export async function reviewInvoice(invoiceId: string): Promise<ReviewResult> {
  try {
    const s = store();
    if (isDemo()) {
      // Hosted demo: hand back the recorded verdict so the stamp can land again.
      const recorded = s.latestDecisions("serv").find((d) => d.invoiceId === invoiceId);
      if (!recorded) return { ok: false, error: DEMO_MESSAGE };
      await new Promise((r) => setTimeout(r, 350));
      return { ok: true, decision: { ...recorded, decidedAt: new Date().toISOString(), calls: recorded.calls.map((c) => ({ ...c, replayed: true })) } };
    }
    const policy = s.livePolicy();
    const invoice = s.invoices().find((i) => i.id === invoiceId);
    if (!policy || !invoice) return { ok: false, error: "Invoice or policy not found." };
    const decision = await decide(new ServClient(), {
      invoice,
      policy,
      contractors: s.contractors(),
      history: s.history(invoice.id),
      mode: MODES.serv,
    });
    s.addDecision(decision, MODES.serv.name);
    revalidatePath("/desk");
    return { ok: true, decision };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("402") ? "Out of SERV credit." : msg.slice(0, 200) };
  }
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => {
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, error: msg.includes("402") ? "Out of SERV credit." : msg.slice(0, 200) };
};

/** Settle a gap: SERV drafts the clause for the reading the company chose; it lands in a new draft version. */
export async function adoptReading(probeIndex: number, readingIndex: number): Promise<ActionResult<{ version: number; clause: string }>> {
  try {
    const { draftClause } = await import("@/src/core/gaps");
    const s = store();
    const live = s.livePolicy();
    const report = s.latestReport<import("@/src/core/gaps").GapReport>("gaps");
    const result = report?.results[probeIndex];
    const reading = result?.probe.readings[readingIndex];
    if (!live || !result || !reading) return { ok: false, error: "That gap is no longer on file." };
    // Build on the newest draft if there is one, so several gaps can be settled in a row.
    const base = s.latestPolicy() ?? live;
    const clause = await draftClause(new ServClient(), base, result.probe, reading);
    const next = s.addPolicy(`${base.text.trimEnd()}\n${base.clauses.length + 1}. ${clause}\n`);
    revalidatePath("/policy");
    return { ok: true, value: { version: next.version, clause } };
  } catch (e) {
    return fail(e);
  }
}

/** Re-decide the live version's invoices under the newest draft and report what would change. */
export async function replayDraft(): Promise<ActionResult<import("@/src/core/replay").ReplayReport>> {
  if (isDemo()) return demoRefusal();
  try {
    const { replay } = await import("@/src/core/replay");
    const s = store();
    const live = s.livePolicy();
    const draft = s.latestPolicy();
    if (!live || !draft || draft.version === live.version) return { ok: false, error: "No draft to replay." };
    const past = s.latestDecisions("serv", live.version);
    const report = await replay(new ServClient(), past, new Map(s.invoices().map((i) => [i.id, i])), draft, s.contractors(), s.history());
    s.addReport("replay", report);
    revalidatePath("/policy");
    return { ok: true, value: report };
  } catch (e) {
    return fail(e);
  }
}

/** Make a version live, then have SERV compile its reasoning graphs in the background (poll with jobStatus). */
export async function makeLive(version: number): Promise<ActionResult<{ version: number; warmJob: string | null }>> {
  if (isDemo()) return demoRefusal();
  try {
    const s = store();
    s.setLivePolicy(version);
    revalidatePath("/", "layout");
    return { ok: true, value: { version, warmJob: s.setting(warmKey(version)) ? null : await startWarm(s, version) } };
  } catch (e) {
    return fail(e);
  }
}

/** Have SERV compile a version's graphs now (background job; poll with jobStatus). */
export async function warmVersion(version: number): Promise<ActionResult<string>> {
  if (isDemo()) return demoRefusal();
  try {
    const id = await startWarm(store(), version);
    return id ? { ok: true, value: id } : { ok: false, error: `No policy v${version}.` };
  } catch (e) {
    return fail(e);
  }
}

async function startWarm(s: Store, version: number): Promise<string | null> {
  const policy = s.policy(version);
  if (!policy) return null;
  const { startJob } = await import("@/lib/jobs");
  return startJob(`warm-v${version}`, async (log) => {
    const report = await warmPolicy(new ServClient(), policy, log);
    s.setSetting(warmKey(version), JSON.stringify(report));
  }).id;
}

/** Pay every approved, unpaid invoice through AgentKit. The CDP policy on the wallet is the last gate. */
export async function payApproved(): Promise<ActionResult<import("@/src/core/pay").PaymentResult[]>> {
  if (isDemo()) return demoRefusal();
  try {
    const { createAgentKitPayer, payApproved: pay } = await import("@/src/core/pay");
    const s = store();
    const paid = s.paidInvoiceIds();
    const todo = s.latestDecisions("serv").filter((d) => d.finalVerdict === "PAY" && !paid.has(d.invoiceId));
    const results = await pay(await createAgentKitPayer(), todo, s.contractors());
    for (const r of results) s.addPayment(r);
    revalidatePath("/", "layout");
    return { ok: true, value: results };
  } catch (e) {
    return fail(e);
  }
}

/**
 * The pay run as an agent: SERV works through the unpaid pile with the payroll
 * wallet in hand (AgentKit tools), in the background; poll with jobStatus.
 * Each progress line is a JSON PayrollEvent. The hosted demo hands back the
 * last recorded run for the browser to replay, with no model and no wallet.
 */
export async function runPayrollAgent(): Promise<ActionResult<{ jobId: string } | { replay: import("@/src/core/payroll").PayrollReport }>> {
  try {
    const s = store();
    if (isDemo()) {
      // Serverless instances don't share memory, so the browser plays the recording.
      const last = s.latestReport<import("@/src/core/payroll").PayrollReport>("payroll");
      return last ? { ok: true, value: { replay: last } } : demoRefusal();
    }
    const { startJob } = await import("@/lib/jobs");
    const { createAgentKitPayer } = await import("@/src/core/pay");
    const { runPayroll } = await import("@/src/core/payroll");
    // PAYRUN_WALLET_KIND=smart: the gasless smart payroll wallet, one batched settlement per run.
    const wallet =
      process.env.PAYRUN_WALLET_KIND === "smart"
        ? (await import("@/src/core/batch")).batchingWallet(await (await import("@/src/core/smartPayer")).createSmartPayer())
        : await createAgentKitPayer();
    const job = startJob("payroll", async (log) => {
      await runPayroll(new ServClient(), s, wallet, (e) => log(JSON.stringify(e)));
      revalidatePath("/", "layout");
    });
    return { ok: true, value: { jobId: job.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Skip every Payrun check and ask the wallet itself to pay the scammer. The signer should refuse. */
export async function tryScammerTransfer(): Promise<ActionResult<{ refused: boolean; message: string }>> {
  try {
    const { createAgentKitPayer } = await import("@/src/core/pay");
    const payer = await createAgentKitPayer();
    if ((await payer.attachedPolicies()).length === 0) return { ok: false, error: "No policy is attached to the wallet, so this would really send." };
    const r = await payer.transfer("0x94e672298C44c94b0606740cBEfa6963fA3409C6", 1);
    return { ok: true, value: { refused: !r.ok, message: r.ok ? `Sent: ${r.txHash}` : r.message.replace(/^Error transferring the asset: (APIError: )?/, "") } };
  } catch (e) {
    return fail(e);
  }
}

/** Save edited clauses as a new draft version. Identical text returns the existing version. */
export async function saveDraft(clauses: string[]): Promise<ActionResult<number>> {
  if (isDemo()) return demoRefusal();
  try {
    const { policyText } = await import("@/src/core/lint");
    if (!clauses.some((c) => c.trim())) return { ok: false, error: "A policy needs at least one clause." };
    const version = store().addPolicy(policyText(clauses));
    revalidatePath("/policy");
    return { ok: true, value: version.version };
  } catch (e) {
    return fail(e);
  }
}

/** SERV reads the wording before any invoice does: conflicts, undefined terms, open cases. */
export async function lintVersion(version: number): Promise<ActionResult<import("@/src/core/lint").LintReport>> {
  if (isDemo()) return demoRefusal();
  try {
    const { lintPolicy } = await import("@/src/core/lint");
    const s = store();
    const policy = s.policy(version);
    if (!policy) return { ok: false, error: `No policy v${version}.` };
    const report = await lintPolicy(new ServClient(), policy);
    s.addReport("lint", report);
    revalidatePath("/policy");
    return { ok: true, value: report };
  } catch (e) {
    return fail(e);
  }
}

/** Start the gap finder on a version in the background; poll with jobStatus. */
export async function findHoles(version: number): Promise<ActionResult<string>> {
  if (isDemo()) return demoRefusal();
  try {
    const { startJob } = await import("@/lib/jobs");
    const { findGaps } = await import("@/src/core/gaps");
    const s = store();
    const policy = s.policy(version);
    if (!policy) return { ok: false, error: `No policy v${version}.` };
    const job = startJob("gaps", async (log) => {
      const report = await findGaps(new ServClient(), policy, s.contractors(), { probes: 4, runsPerProbe: 3, onProgress: log });
      s.addReport("gaps", report);
      log(`Done: ${report.gaps.length} of ${report.results.length} probes expose a hole.`);
    });
    return { ok: true, value: job.id };
  } catch (e) {
    return fail(e);
  }
}

export async function jobStatus(id: string): Promise<ActionResult<import("@/lib/jobs").Job>> {
  const { getJob } = await import("@/lib/jobs");
  const job = getJob(id);
  return job ? { ok: true, value: { ...job, progress: [...job.progress] } } : { ok: false, error: "That job is gone (the server restarted)." };
}

/** Live balance of the paying wallet on Base Sepolia. */
export async function payerBalance(): Promise<ActionResult<{ address: string; usdc: number; eth: number }>> {
  try {
    const address = process.env.PAYRUN_WALLET_ADDRESS as `0x${string}` | undefined;
    if (!address) return { ok: false, error: "No paying wallet yet. Run the wallet address command once." };
    const { createPublicClient, erc20Abi, formatUnits, http } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const { USDC_BASE_SEPOLIA } = await import("@/src/core/walletPolicy");
    const client = createPublicClient({ chain: baseSepolia, transport: http() });
    const [usdc, eth] = await Promise.all([
      client.readContract({ address: USDC_BASE_SEPOLIA as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      client.getBalance({ address }),
    ]);
    return { ok: true, value: { address, usdc: Number(formatUnits(usdc, 6)), eth: Number(formatUnits(eth, 18)) } };
  } catch (e) {
    return fail(e);
  }
}

/** SERV reads a pasted agreement into a draft contractor for the owner to confirm. */
export async function readAgreementText(text: string): Promise<ActionResult<import("@/src/core/agreement").AgreementDraft>> {
  if (isDemo()) return demoRefusal();
  try {
    if (text.trim().length < 40) return { ok: false, error: "Paste the agreement or the email that sets the terms." };
    const { readAgreement } = await import("@/src/core/agreement");
    return { ok: true, value: await readAgreement(new ServClient(), text) };
  } catch (e) {
    return fail(e);
  }
}

export async function saveContractor(input: import("@/src/core/types").Contractor & { isNew?: boolean }): Promise<ActionResult<string>> {
  try {
    const { contractorProblems, slugId } = await import("@/src/core/agreement");
    const problems = contractorProblems(input);
    if (problems.length) return { ok: false, error: problems.join(" ") };
    const s = store();
    const owner = s.setting("owner_wallet");
    if (owner && input.wallet.toLowerCase() === owner.toLowerCase()) return { ok: false, error: "That is the owner's wallet. A contractor needs their own." };
    const taken = new Set(s.contractors().map((c) => c.id));
    const id = input.isNew || !input.id ? slugId(input.name, taken) : input.id;
    const { isNew: _drop, ...c } = input;
    s.upsertContractors([{ ...c, id, network: "base-sepolia", dayRateUsdc: Number(c.dayRateUsdc), monthlyDayCap: Number(c.monthlyDayCap), expenseApprovals: c.expenseApprovals ?? [] }]);
    revalidatePath("/", "layout");
    return { ok: true, value: id };
  } catch (e) {
    return fail(e);
  }
}

export async function removeContractor(id: string): Promise<ActionResult<string>> {
  if (isDemo()) return demoRefusal();
  try {
    store().deleteContractor(id);
    revalidatePath("/", "layout");
    return { ok: true, value: id };
  } catch (e) {
    return fail(e);
  }
}

/** Compile the contractor book into the wallet's own rules and attach them to the paying wallet. */
export async function attachWalletRules(): Promise<ActionResult<string>> {
  if (isDemo()) return demoRefusal();
  try {
    const { createAgentKitPayer } = await import("@/src/core/pay");
    const s = store();
    const policy = s.livePolicy();
    if (!policy) return { ok: false, error: "No live policy." };
    const owner = s.setting("owner_wallet");
    const payer = await createAgentKitPayer();
    const id = await payer.applyPolicy(policy, s.contractors(), owner);
    s.setSetting("wallet_rules", JSON.stringify({ id, fingerprint: walletRulesFingerprint(s.contractors(), policy, owner), at: new Date().toISOString() }));
    revalidatePath("/", "layout");
    return { ok: true, value: id };
  } catch (e) {
    return fail(e);
  }
}

export interface OwnerStatus {
  /** The company owner's own wallet: the only place withdrawals can go. */
  owner: string | null;
  /** The rules attached to the payroll wallet include the owner's withdraw rule. */
  withdrawReady: boolean;
}

function ownerStatusOf(s: Store): OwnerStatus {
  const owner = s.setting("owner_wallet");
  const policy = s.livePolicy();
  const saved = s.setting("wallet_rules");
  if (!owner || !policy || !saved) return { owner, withdrawReady: false };
  return { owner, withdrawReady: (JSON.parse(saved) as { fingerprint: string }).fingerprint === walletRulesFingerprint(s.contractors(), policy, owner) };
}

export async function ownerWallet(): Promise<ActionResult<OwnerStatus>> {
  try {
    return { ok: true, value: ownerStatusOf(store()) };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Record the wallet the owner topped up from as the owner wallet. The first
 * connected wallet is saved automatically; replacing it is an explicit choice.
 * Either way the withdraw rule only takes effect once the rules are re-attached.
 */
export async function setOwnerWallet(address: string, replace = false): Promise<ActionResult<OwnerStatus>> {
  if (isDemo()) return demoRefusal();
  try {
    const { getAddress, isAddress } = await import("viem");
    if (!isAddress(address)) return { ok: false, error: "That is not a wallet address." };
    const s = store();
    const current = s.setting("owner_wallet");
    if (current && !replace) return { ok: true, value: ownerStatusOf(s) };
    if (s.contractors().some((c) => c.wallet.toLowerCase() === address.toLowerCase())) {
      return { ok: false, error: "That wallet is in the contractor book. The owner needs a wallet of their own." };
    }
    s.setSetting("owner_wallet", getAddress(address));
    revalidatePath("/", "layout");
    return { ok: true, value: ownerStatusOf(s) };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Send USDC from the payroll wallet back to the owner wallet on file. The
 * destination is never taken from the request, and Coinbase's signer only
 * allows it because the owner's withdraw rule is attached.
 */
export async function withdrawToOwner(amountUsdc: number): Promise<ActionResult<{ txHash: string; to: string }>> {
  if (isDemo()) return demoRefusal();
  try {
    const s = store();
    const { owner, withdrawReady } = ownerStatusOf(s);
    if (!owner) return { ok: false, error: "No owner wallet on file. Connect the wallet you top up from first." };
    if (!withdrawReady) return { ok: false, error: "The withdraw rule is not on the wallet yet. Attach the rules first." };
    if (!(amountUsdc > 0)) return { ok: false, error: "Enter an amount above zero." };
    const balance = await payerBalance();
    if (balance.ok && amountUsdc > balance.value.usdc) return { ok: false, error: `The payroll wallet holds ${balance.value.usdc} test USDC.` };
    const { createAgentKitPayer } = await import("@/src/core/pay");
    const r = await (await createAgentKitPayer()).transfer(owner, Math.round(amountUsdc * 1e6) / 1e6);
    if (!r.ok || !r.txHash) return { ok: false, error: r.message.replace(/^Error transferring the asset: (APIError: )?/, "").slice(0, 200) };
    return { ok: true, value: { txHash: r.txHash, to: owner } };
  } catch (e) {
    return fail(e);
  }
}

import { runInvoiceAgent, type AgentRun, type AgentStep, type AgentWallet } from "./agent";
import type { BatchingWallet } from "./batch";
import { isPolicyRejection } from "./pay";
import type { ServClient } from "./serv";
import type { Store } from "./store";

export interface PayrollReport {
  startedAt: string;
  finishedAt: string;
  policyVersion: number;
  wallet: string | null;
  runs: (Omit<AgentRun, "decision"> & { name: string; verdict: string; amountUsdc: number })[];
}

export type PayrollEvent = { invoiceId: string; name: string } & ({ type: "start" } | { type: "step"; step: AgentStep } | { type: "done"; verdict: string });

/**
 * One pay run: the SERV agent works through every unpaid invoice in arrival
 * order, with the payroll wallet in hand. Each decision and payment is stored
 * as it happens, so a later invoice sees the earlier ones in its history.
 */
export async function runPayroll(serv: ServClient, store: Store, wallet: AgentWallet | null, onEvent?: (e: PayrollEvent) => void): Promise<PayrollReport> {
  const policy = store.livePolicy();
  if (!policy) throw new Error("No live policy.");
  const contractors = store.contractors();
  const paid = store.paidInvoiceIds();
  const startedAt = new Date().toISOString();
  const runs: PayrollReport["runs"] = [];
  for (const invoice of store.invoices().filter((i) => !paid.has(i.id))) {
    const who = (id: string | null) => contractors.find((c) => c.id === id)?.name;
    let name = invoice.id.replace(/^\d+-/, "");
    onEvent?.({ type: "start", invoiceId: invoice.id, name });
    const run = await runInvoiceAgent(serv, {
      invoice,
      policy,
      contractors,
      history: store.history(invoice.id),
      wallet,
      onStep: (step) => onEvent?.({ type: "step", invoiceId: invoice.id, name, step }),
    });
    name = who(run.decision.contractorId) ?? name;
    store.addDecision(run.decision, "serv");
    if (run.payment) store.addPayment(run.payment);
    onEvent?.({ type: "done", invoiceId: invoice.id, name, verdict: run.decision.finalVerdict });
    runs.push({ invoiceId: run.invoiceId, steps: run.steps, payment: run.payment, name, verdict: run.decision.finalVerdict, amountUsdc: run.decision.payAmountUsdc });
  }
  // A batching wallet settles every approved transfer now, in one user operation.
  const batch = wallet && "flush" in wallet ? await (wallet as BatchingWallet).flush() : null;
  if (batch) {
    const status = batch.ok ? "sent" : isPolicyRejection(batch.message) ? "rejected" : "failed";
    const queued = runs.filter((r) => r.payment?.status === "queued");
    for (const r of queued) {
      const payment = { ...r.payment!, status, txHash: batch.txHash, message: batch.message, sentAt: new Date().toISOString() } as const;
      store.addPayment(payment);
      const step: AgentStep = batch.ok
        ? { actor: "Coinbase", title: "signed the batched transfer", detail: `${queued.length} payouts in one gasless user operation.`, ok: true, txHash: batch.txHash }
        : { actor: "Coinbase", title: status === "rejected" ? "signer refused the batch" : "batch failed", detail: batch.message.slice(0, 240), ok: false };
      r.steps.push(step);
      r.payment = payment;
      onEvent?.({ type: "step", invoiceId: r.invoiceId, name: r.name, step });
    }
  }
  const report: PayrollReport = { startedAt, finishedAt: new Date().toISOString(), policyVersion: policy.version, wallet: wallet?.address ?? null, runs };
  store.addReport("payroll", report);
  return report;
}

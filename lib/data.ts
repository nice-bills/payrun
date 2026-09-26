import "server-only";
import { dbPath, isDemo } from "@/lib/demo";
import { Store } from "@/src/core/store";
import type { GapReport } from "@/src/core/gaps";
import type { LintReport } from "@/src/core/lint";
import type { ReplayReport } from "@/src/core/replay";
import { warmKey, type WarmReport } from "@/src/core/warmStatus";
import type { PaymentResult } from "@/src/core/pay";
import type { Contractor, Decision, Invoice, PolicyVersion } from "@/src/core/types";

/** One read of everything the desk shows. Plain JSON, safe to pass to client components. */
export interface DeskData {
  /** The live version: invoices are decided under this one. */
  policy: PolicyVersion | null;
  policies: PolicyVersion[];
  contractors: Contractor[];
  items: DeskItem[];
  payments: PaymentResult[];
  gaps: GapReport | null;
  replay: ReplayReport | null;
  /** Latest SERV lint per policy version. */
  lints: Record<number, LintReport>;
  /** Whether SERV has compiled each version's reasoning graphs (warmed on going live). */
  warm: Record<number, WarmReport>;
}

export interface DeskItem {
  invoice: Invoice;
  decision: Decision | null;
  /** Policy text of the version this decision ran under, so notes can quote the clause. */
  clauses: string[];
  paid: PaymentResult | null;
}

function store(): Store {
  return new Store(dbPath(), { readOnly: isDemo() });
}

export function loadDesk(): DeskData {
  const s = store();
  const policies = s.policies();
  const byVersion = new Map(policies.map((p) => [p.version, p]));
  const decisions = new Map(s.latestDecisions("serv").map((d) => [d.invoiceId, d]));
  // A batched pay run records "queued" and then the batch's outcome; show the outcome.
  const all = s.payments();
  const payments = all.filter((p, i) => p.status !== "queued" || !all.slice(i + 1).some((q) => q.invoiceId === p.invoiceId));
  const lastPayment = (id: string) => payments.filter((p) => p.invoiceId === id).at(-1) ?? null;
  const items = s.invoices().map((invoice) => {
    const decision = decisions.get(invoice.id) ?? null;
    return {
      invoice,
      decision,
      clauses: decision ? byVersion.get(decision.policyVersion)?.clauses ?? [] : [],
      paid: lastPayment(invoice.id),
    };
  });
  return {
    policy: s.livePolicy(),
    policies,
    contractors: s.contractors(),
    items,
    payments,
    gaps: s.latestReport<GapReport>("gaps"),
    replay: s.latestReport<ReplayReport>("replay"),
    lints: Object.fromEntries(s.reports<LintReport>("lint").map((l) => [l.policyVersion, l])),
    warm: Object.fromEntries(
      policies.flatMap((p) => {
        const w = s.setting(warmKey(p.version));
        return w ? [[p.version, JSON.parse(w) as WarmReport]] : [];
      }),
    ),
  };
}

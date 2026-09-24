"use server";

import { revalidatePath } from "next/cache";
import { decide, MODES } from "@/src/core/decide";
import { ServClient } from "@/src/core/serv";
import { Store } from "@/src/core/store";
import type { Decision } from "@/src/core/types";

const store = () => new Store(process.env.PAYRUN_DB ?? "data/payrun.db");

export type ReviewResult = { ok: true; decision: Decision } | { ok: false; error: string };

/**
 * Re-decide one invoice under the current policy. With PAYRUN_SERV_CASSETTE=auto
 * an identical request is answered from the recording, so re-reviewing an
 * unchanged invoice costs nothing.
 */
export async function reviewInvoice(invoiceId: string): Promise<ReviewResult> {
  try {
    const s = store();
    const policy = s.latestPolicy();
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

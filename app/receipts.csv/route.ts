import { receiptsCsv } from "@/src/core/receipts";
import { Store } from "@/src/core/store";

export const dynamic = "force-dynamic";

export function GET() {
  const s = new Store(process.env.PAYRUN_DB ?? "data/payrun.db");
  return new Response(receiptsCsv(s.latestDecisions("serv"), s.payments(), s.contractors()), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="payrun-receipts.csv"' },
  });
}

import { PayoutsBoard } from "@/components/payouts/PayoutsBoard";
import { loadDesk } from "@/lib/data";
import { dbPath, isDemo } from "@/lib/demo";
import { Store } from "@/src/core/store";
import { agreementMaxUsdc, settlementScale, toSettled } from "@/src/core/walletPolicy";

export const dynamic = "force-dynamic";

export default function PayoutsPage() {
  const data = loadDesk();
  const name = (id: string | null | undefined) => data.contractors.find((c) => c.id === id)?.name ?? "Unknown";
  const due = data.items
    .filter((i) => i.decision?.finalVerdict === "PAY" && i.paid?.status !== "sent")
    .map((i) => ({ invoiceId: i.invoice.id, name: name(i.decision?.contractorId), amountUsdc: i.decision!.payAmountUsdc }));
  // Latest payment per invoice, newest first.
  const seen = new Set<string>();
  const paid = [...data.payments]
    .reverse()
    .filter((p) => (seen.has(p.invoiceId) ? false : (seen.add(p.invoiceId), true)))
    .map((p) => ({ ...p, name: name(p.contractorId) }));
  const scale = settlementScale();
  const tags = data.contractors.map((c) => ({
    id: c.id,
    name: c.name,
    wallet: c.wallet,
    maxUsdc: agreementMaxUsdc(c),
    maxSettled: toSettled(agreementMaxUsdc(c), scale),
  }));
  return <PayoutsBoard due={due} paid={paid} tags={tags} payer={process.env.PAYRUN_WALLET_ADDRESS ?? null} owner={new Store(dbPath(), { readOnly: isDemo() }).setting("owner_wallet")} scale={scale} />;
}

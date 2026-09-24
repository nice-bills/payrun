import { Desk } from "@/components/desk/Desk";
import { TopBar } from "@/components/TopBar";
import { loadDesk } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function DeskPage() {
  const data = loadDesk();
  const toPay = data.items.filter((i) => i.decision?.finalVerdict === "PAY" && i.paid?.status !== "sent");
  return (
    <>
      <TopBar
        policyVersion={data.policy?.version ?? null}
        toPay={toPay.length}
        toPayUsdc={toPay.reduce((s, i) => s + (i.decision?.payAmountUsdc ?? 0), 0)}
        paidCount={data.items.filter((i) => i.paid?.status === "sent").length}
      />
      <Desk items={data.items} contractors={data.contractors} />
    </>
  );
}

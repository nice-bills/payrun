import { TopBar } from "@/components/TopBar";
import { loadDesk } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * App frame: exactly one viewport tall. The page never scrolls; each column
 * inside a page owns its own scroll, so nested scroll areas never fight.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const data = loadDesk();
  const toPay = data.items.filter((i) => i.decision?.finalVerdict === "PAY" && i.paid?.status !== "sent");
  return (
    <div className="cork flex h-dvh flex-col overflow-hidden">
      <TopBar
        policyVersion={data.policy?.version ?? null}
        toPay={toPay.length}
        toPayUsdc={toPay.reduce((s, i) => s + (i.decision?.payAmountUsdc ?? 0), 0)}
        paidCount={data.items.filter((i) => i.paid?.status === "sent").length}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

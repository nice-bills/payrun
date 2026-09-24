import { dbPath, isDemo } from "@/lib/demo";
import { ContractorBook } from "@/components/contractors/ContractorBook";
import { loadDesk } from "@/lib/data";
import { walletRulesFingerprint } from "@/lib/walletRules";
import { Store } from "@/src/core/store";

export const dynamic = "force-dynamic";

export default function ContractorsPage() {
  const data = loadDesk();
  const saved = new Store(dbPath(), { readOnly: isDemo() }).setting("wallet_rules");
  const attached = saved ? (JSON.parse(saved) as { fingerprint: string; at: string }) : null;
  const current = data.policy ? walletRulesFingerprint(data.contractors, data.policy) : null;
  return <ContractorBook contractors={data.contractors} rulesCurrent={!!attached && attached.fingerprint === current} rulesAttachedAt={attached?.at ?? null} />;
}

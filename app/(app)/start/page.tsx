import type { Metadata } from "next";
import { SetupChecklist, type SetupStep } from "@/components/start/SetupChecklist";
import { loadDesk } from "@/lib/data";
import { dbPath, isDemo } from "@/lib/demo";
import { walletRulesFingerprint } from "@/lib/walletRules";
import { Store } from "@/src/core/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Get started · Payrun" };

/** The payroll wallet's USDC on Base Sepolia, or null when it can't be read. */
async function payrollBalance(address: string | undefined): Promise<number | null> {
  if (!address) return null;
  try {
    const { createPublicClient, erc20Abi, formatUnits, http } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const { USDC_BASE_SEPOLIA } = await import("@/src/core/walletPolicy");
    const client = createPublicClient({ chain: baseSepolia, transport: http() });
    const v = await client.readContract({ address: USDC_BASE_SEPOLIA as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
    return Number(formatUnits(v, 6));
  } catch {
    return null;
  }
}

export default async function StartPage() {
  const data = loadDesk();
  const store = new Store(dbPath(), { readOnly: isDemo() });
  const wallet = process.env.PAYRUN_WALLET_ADDRESS;
  const owner = store.setting("owner_wallet");
  const saved = store.setting("wallet_rules");
  const attached = saved ? (JSON.parse(saved) as { fingerprint: string }) : null;
  const rulesCurrent = !!attached && !!data.policy && attached.fingerprint === walletRulesFingerprint(data.contractors, data.policy, owner);
  const balance = await payrollBalance(wallet);
  const ranPayroll = !!store.latestReport("payroll") || data.payments.length > 0;
  const holes = data.gaps?.results.filter((r) => r.gap.length).length ?? 0;

  const steps: SetupStep[] = [
    {
      title: "Write your payment policy",
      why: "Plain English, one rule per line. It becomes the agent's instructions, compiled by SERV Reasoning into its reasoning graph.",
      done: !!data.policy,
      status: data.policy ? `v${data.policy.version} is live · ${data.policy.clauses.length} clauses` : "No policy yet",
      href: "/policy",
      cta: "Write the policy",
    },
    {
      title: "Let SERV find the holes",
      why: "SERV writes boundary invoices and judges each one three times. Where your wording leaves the answer open, you pick what you meant.",
      done: !!data.gaps,
      status: data.gaps ? `${holes} hole${holes === 1 ? "" : "s"} found in v${data.gaps.policyVersion}` : "Not checked yet",
      href: "/policy",
      cta: "Find holes",
    },
    {
      title: "Add your contractors",
      why: "Name, wallet, day rate and monthly cap. Paste an agreement and SERV fills the card in for you to confirm.",
      done: data.contractors.length > 0,
      status: data.contractors.length ? `${data.contractors.length} contractors on file` : "Nobody on file",
      href: "/contractors",
      cta: "Open the contractor book",
    },
    {
      title: "Create your payroll wallet",
      why: "A Coinbase wallet under your own developer account. Payrun drives it through AgentKit; only your keys can sign for it.",
      done: !!wallet,
      status: wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)} on Base Sepolia` : "Run: npm run cli -- wallet address",
      href: "/payouts",
      cta: "See the wallet",
    },
    {
      title: "Attach the wallet's own rules",
      why: "Coinbase's signer then refuses any transfer outside the contractor book or above an agreement's cap, whatever the agent decides.",
      done: rulesCurrent,
      status: rulesCurrent ? "Rules match the contractor book" : attached ? "Out of date: the book changed since" : "Not attached",
      href: "/contractors",
      cta: "Attach the rules",
    },
    {
      title: "Fund the payroll wallet",
      why: "Top it up from your own wallet with test USDC. The wallet you top up from becomes the only place withdrawals can go.",
      done: (balance ?? 0) > 0,
      status: balance === null ? "Balance unavailable" : `${balance} test USDC`,
      href: "/payouts",
      cta: "Top up",
    },
    {
      title: "Run payroll",
      why: "The SERV agent reads each invoice against your policy and pays, holds or blocks it through AgentKit. Every step shows who acted.",
      done: ranPayroll,
      status: ranPayroll ? `${data.payments.filter((p) => p.status === "sent").length} paid so far` : "Not run yet",
      href: "/payouts",
      cta: "Run payroll",
    },
  ];
  return <SetupChecklist steps={steps} demo={isDemo()} />;
}

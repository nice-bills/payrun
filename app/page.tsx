import type { Metadata } from "next";
import { Landing, type LandingData } from "@/components/landing/Landing";
import { loadDesk } from "@/lib/data";
import { loadProof } from "@/lib/proof";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payrun · pay contractors by the book",
  description: "Write your payment policy in plain English. Payrun reads every invoice against it with SERV Reasoning, finds the holes in your wording, and makes the paying wallet obey it.",
};

export default function Home() {
  const desk = loadDesk();
  const proof = loadProof();
  const holes = (desk.gaps?.results ?? [])
    .filter((r) => r.gap.length)
    .map((r) => ({ title: r.probe.title, why: r.probe.whyAmbiguous, today: r.verdicts[0], readings: r.probe.readings }));
  const serv = proof.eval?.summary?.serv;
  const data: LandingData = {
    holes,
    clauseCount: proof.clauseCount,
    cases: proof.eval?.cases ?? 0,
    traps: serv?.final.trapsCaught ?? "",
    flips: proof.consistency ? { ...proof.consistency.flips, probes: proof.consistency.probes } : null,
  };
  return <Landing data={data} />;
}

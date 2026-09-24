import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy · Payrun" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="24 September 2026">
      <h2>What leaves your machine</h2>
      <p>
        Invoice text, your payment policy and the matching contractor agreement are sent to SERV Reasoning (OpenServ) to be read and judged. For this hackathon build, data collection is enabled on the SERV
        organisation, as the hackathon rules require, so OpenServ may keep those requests. Do not load real personal or financial documents into this build.
      </p>
      <p>Payment instructions go to Coinbase Developer Platform, which signs and sends transfers on Base Sepolia. Transfers are public on the blockchain.</p>
      <h2>What stays local</h2>
      <p>Invoices, decisions, policy versions and receipts are stored in a SQLite file on the machine running Payrun. Recorded SERV responses are stored alongside it so demos can replay without new requests.</p>
      <h2>What we don&apos;t do</h2>
      <p>No analytics, no advertising, no selling data. The one exception we know of: Coinbase&apos;s AgentKit library sends its own usage events to Coinbase.</p>
      <h2>Contact</h2>
      <p>Questions go to the project repository&apos;s issue tracker.</p>
    </LegalPage>
  );
}

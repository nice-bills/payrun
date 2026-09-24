import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms · Payrun" };

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="24 September 2026">
      <p>Payrun is a hackathon build for the OpenServ SERV Hackathon. It is offered as is, to try out, and it is not a regulated payment service.</p>
      <h2>Testnet only</h2>
      <p>Payrun moves test USDC on Base Sepolia. Test USDC has no value. Invoice amounts are settled at a disclosed scale (1/1000 by default) so a testnet faucet can cover a month of invoices.</p>
      <h2>Decisions are advice</h2>
      <p>
        Verdicts come from your written policy, code checks and a language model. They can be wrong. You decide what gets paid; Payrun only pays invoices marked PAY, and only to the wallet on file, within the limits
        attached to the paying wallet.
      </p>
      <h2>Your keys</h2>
      <p>You bring your own SERV and Coinbase Developer Platform keys. They stay in your environment file and are never shown in the interface.</p>
      <h2>No warranty</h2>
      <p>To the extent the law allows, the authors are not liable for losses from using Payrun, including payments you approve.</p>
    </LegalPage>
  );
}

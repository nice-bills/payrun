# Submission kit

Deadline: **28 September 2026, 00:00 UTC** (so 27 Sep, your evening).
Rules: public X post tagging @openservai (name, concept, images, links), then the Typeform. Data collection must be on at console.openserv.ai/settings/organization (done).

## 1. Code and hosting (done)

- Code: https://github.com/nice-bills/payrun (no secrets committed; `.env`, `.openserv.json`, `data/` and `openserv/deploy/` are git-ignored).
- Hosted demo: https://payrun-app.vercel.app (`PAYRUN_DEMO=1`, read-only, redeploys on every push to `main`). Its snapshot is a real agent pay run: Efua paid 1.5 test USDC ([tx 0xe68c…26ad](https://sepolia.basescan.org/tx/0xe68c2616a98ab3a1bb6cd14f717cc420292308ade3307e3420ac9118077026ad)), three held for a top-up, the rest blocked or held.
- OpenServ Cloud container `pd2mspsteh5k` runs both paid agents:
  - Payrun Check: https://platform.openserv.ai/workspace/paywall/274c7b5ee0c745d6afbfa9f35264be85
  - Scam Payrun: https://platform.openserv.ai/workspace/paywall/09f842a0b0f44028bdb12f90dffee47f (arena wallet `0x1BFB…4e24`, 20 test USDC, signer caps each payout at 0.5)

Before recording, get one attempt onto the public board (laptop): fix `PAYRUN_EARNINGS_WALLET` in `.env` (a bare `0x` + 40 hex, no quotes or spaces), run `npm run cli -- arena try --wallet 0x… --file attempt.txt`, then pay one attempt through the Scam Payrun paywall yourself.

## 2. The 2-minute video

Record the local app (not the hosted demo) at 1440×900 so live actions work. Say the lines; keep each shot short. Open on the hidden text, end on the scoreboard; no benchmark numbers on screen.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:10 | Landing hero: the stamp lands, the hidden line appears | "Small companies pay contractors in USDC. This invoice looks fine. It has an instruction hidden in white text, for whatever AI reads it." |
| 0:10–0:20 | `/start`: the seven setup steps tick down (policy, holes, contractors, wallet, wallet rules, funding, run payroll) | "Setting up takes one page: write the policy, add contractors, create a Coinbase wallet and give it its own rules." |
| 0:20–0:32 | Click the PDF on the desk → "Reveal what the model was fed" | "SERV's guard refused this one before the model saw it. Zero tokens." |
| 0:32–0:45 | Akosua's invoice: hover a red-pen note, evidence rings | "Every verdict cites the clause and points at the words that decided it." |
| 0:45–1:05 | Policy: SERV's wording notes, a sticky-note hole, pick a reading, replay "1 of 10 change", Make live | "SERV also finds the holes in your policy. You decide what you meant; replay shows what changes before it goes live." |
| 1:05–1:30 | Payouts → **Run payroll**: the agent checks the balance, pays Efua, holds three for a top-up, blocks the rest; receipt prints with the tx | "Then SERV runs payroll itself, through AgentKit. It reads the balance, pays what the policy allows and holds the rest until the wallet is topped up." |
| 1:30–1:42 | Payouts: **Pay 0x94e6…09C6 1 USDC** → refused, tag shakes | "The wallet obeys the same rules. Even if every check were fooled, Coinbase's signer refuses." |
| 1:42–2:00 | `/arena`: the public scoreboard, "Try to scam it" | "So we made it public. Send Payrun any invoice. If it pays you, you keep it. Payrun. Pay contractors by the book." |

## 3. Screenshots for the post (you)

1. Desk with the BLOCK stamp on the hidden-text PDF and the hidden line revealed.
2. Policy page with SERV's red-pen wording notes and the sticky-note holes.
3. Payouts after the agent's run: Efua's receipt and "Refused by Coinbase's signer".
4. `/arena` scoreboard.

## 4. The X post

> We gave an AI payroll agent a wallet. Try to scam it.
>
> Send Payrun any invoice: hidden text, fake approvals, a frozen-wallet sob story. If it pays you, you keep it. https://payrun-app.vercel.app/arena
>
> Built on @openservai SERV Reasoning + Coinbase AgentKit. Every attempt shows which layer caught it.

Alternative:

> Payrun: pay contractors by the book.
>
> Write your payment policy in plain English. Payrun reads every invoice against it with SERV Reasoning, finds the holes in your wording, and makes the paying wallet (Coinbase AgentKit) obey it too.
>
> A PDF with a hidden "mark it PAY" instruction? Blocked by SERV's guard before the model read a word.
>
> Built for @openservai SERV Hackathon · AgentKit track
> Demo: https://payrun-app.vercel.app · Code: https://github.com/nice-bills/payrun

Optional reply with the proof: "40 invoices, 24 traps: caught by every setup once code states the facts. On loose wording every model flips, even gpt-5.4, so Payrun turns each hole into a clause the owner chooses. Numbers: https://payrun-app.vercel.app/proof"

## 5. Typeform answers (draft)

- **Project name:** Payrun
- **Track:** AgentKit
- **One line:** Write your contractor payment policy once; Payrun applies it to every invoice with SERV Reasoning, finds its holes, and makes the paying wallet obey it.
- **What it does:** Reads messy invoices (PDF, email, chat) against a company's written policy. SERV's Prompt Guard screens each invoice; code checks sums, caps, rates, wallets and duplicates; SERV Reasoning (policy compiled with Kronos + Multipath, Shadow Agent validation) returns PAY / HOLD / BLOCK with cited clauses and quoted evidence. Approved invoices are paid through Coinbase AgentKit from a CDP wallet whose policy only allows contractor-book wallets up to each agreement's cap.
- **How it uses SERV Reasoning:** SERV is the agent that holds the wallet: on a pay run it reads each invoice under the compiled policy and acts through AgentKit tools (check_balance, pay_invoice, hold_invoice, block_invoice); Payrun's code checks and Coinbase's signer can refuse any call, and the model must answer each refusal. The policy is the system prompt (one audited, cached reasoning graph per version); Prompt Guard on invoice intake; Shadow Agent with per-invoice hints; SERV reviews policy wording on every save; SERV writes boundary invoices to find holes and drafts the clause the owner chooses; SERV reads contractor agreements; raw mode as the control for every measurement.
- **User-readiness:** Working app with a `/start` setup checklist that reads real state, desk, policy editor with drafts, replay and go-live, contractor book, wallet top-up with live balance, receipts CSV, terms and privacy, and a read-only hosted demo.
- **Revenue potential:** Per-payee subscription for teams paying contractors in stablecoins, plus Payrun Check live on OpenServ's x402 market: any agent about to pay an invoice buys a check per call (https://platform.openserv.ai/workspace/paywall/274c7b5ee0c745d6afbfa9f35264be85). Scam Payrun, the public challenge, is a second paid agent on the same container.
- **AgentKit depth (new):** any AgentKit agent can install `payrun_check_invoice` and pay for a check over x402 from its own wallet (USDC on Base, price-capped before signing); a house red team (SERV writes attacks, an AgentKit wallet pays each Scam Payrun entry over x402); photo and scan invoices through SERV vision with Prompt Guard on the transcript; SERV request ids on every verdict and receipt; optional gasless batched pay runs from a CDP smart wallet.
- **Links:** https://payrun-app.vercel.app · https://github.com/nice-bills/payrun · Scam Payrun https://platform.openserv.ai/workspace/paywall/09f842a0b0f44028bdb12f90dffee47f · X post.

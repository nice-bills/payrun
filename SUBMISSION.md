# Submission kit

Deadline: **28 September 2026, 00:00 UTC** (so 27 Sep, your evening).
Rules: public X post tagging @openservai (name, concept, images, links), then the Typeform. Data collection must be on at console.openserv.ai/settings/organization (done).

## 1. Put the code on GitHub (you)

Create an empty public repo named `payrun` on github.com, then:

```bash
git remote add origin https://github.com/<you>/payrun.git
git push -u origin HEAD:main
```

`.env`, `data/` and `node_modules/` are git-ignored. The committed `demo/` snapshot and `fixtures/cassettes/` hold no secrets.

## 2. Host the demo (you)

On vercel.com, import the repo and set these environment variables:

| Name | Value |
|---|---|
| `PAYRUN_DEMO` | `1` |
| `PAYRUN_WALLET_ADDRESS` | `0x878f6621a3bAF5d037bbA918d80d804c8b8FD56B` |
| `PAYRUN_MODEL` | `gpt-6-luna` |

Do **not** add SERV or CDP keys to the hosted demo. Node 24 is pinned in `package.json`.

## 3. The 2-minute video

Record the local app (not the hosted demo) at 1440×900 so live actions work. Say the lines; keep each shot short.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:12 | Landing hero: the stamp lands, the hidden line appears | "Small companies pay contractors in USDC. This invoice looks fine. It has an instruction hidden in white text, for whatever AI reads it." |
| 0:12–0:35 | Desk → **Review the pile** runs; conveyor tracks each card; stamps land | "Payrun reads every invoice against the company's written policy with SERV Reasoning. The guard reads it first; code checks the sums and the wallet; SERV applies the clauses." |
| 0:35–0:50 | Click the PDF → "Reveal what the model was fed" | "SERV's guard refused this one before the model saw it. Zero tokens." |
| 0:50–1:05 | Akosua's invoice: hover a red-pen note, evidence rings | "Every verdict cites the clause and points at the words that decided it." |
| 1:05–1:25 | Policy: SERV's wording notes, a sticky-note hole, pick a reading, replay "1 of 10 change", Make live | "SERV also finds the holes in your policy. You decide what you meant; replay shows what changes before it goes live." |
| 1:25–1:45 | Payouts: live balance, receipts print, **Pay the scammer** → refused, tag shakes | "The wallet obeys the same rules. Even if every check were fooled, Coinbase's signer refuses." |
| 1:45–2:00 | Proof page scroll; end on the landing hero | "Measured, not claimed. Payrun. Pay contractors by the book." |

## 4. Screenshots for the post (you)

1. Desk with the BLOCK stamp on the hidden-text PDF and the hidden line revealed.
2. Policy page with SERV's red-pen wording notes and the sticky-note holes.
3. Payouts with the receipts and "Refused by Coinbase's signer".
4. Landing hero.

## 5. The X post

> Payrun: pay contractors by the book.
>
> Write your payment policy in plain English. Payrun reads every invoice against it with SERV Reasoning, finds the holes in your wording, and makes the paying wallet (Coinbase AgentKit) obey it too.
>
> A PDF with a hidden "mark it PAY" instruction? Blocked by SERV's guard before the model read a word.
>
> Built for @openservai SERV Hackathon · AgentKit track
> Demo: <vercel link> · Code: <github link>

Optional reply with the proof: "40 invoices, 24 traps: caught by every setup once code states the facts. On loose wording every model flips, even gpt-5.4, so Payrun turns each hole into a clause the owner chooses. Numbers: <link>/proof"

## 6. Typeform answers (draft)

- **Project name:** Payrun
- **Track:** AgentKit
- **One line:** Write your contractor payment policy once; Payrun applies it to every invoice with SERV Reasoning, finds its holes, and makes the paying wallet obey it.
- **What it does:** Reads messy invoices (PDF, email, chat) against a company's written policy. SERV's Prompt Guard screens each invoice; code checks sums, caps, rates, wallets and duplicates; SERV Reasoning (policy compiled with Kronos + Multipath, Shadow Agent validation) returns PAY / HOLD / BLOCK with cited clauses and quoted evidence. Approved invoices are paid through Coinbase AgentKit from a CDP wallet whose policy only allows contractor-book wallets up to each agreement's cap.
- **How it uses SERV Reasoning:** SERV is the agent that holds the wallet: on a pay run it reads each invoice under the compiled policy and acts through AgentKit tools (check_balance, pay_invoice, hold_invoice, block_invoice); Payrun's code checks and Coinbase's signer can refuse any call, and the model must answer each refusal. The policy is the system prompt (one audited, cached reasoning graph per version); Prompt Guard on invoice intake; Shadow Agent with per-invoice hints; SERV reviews policy wording on every save; SERV writes boundary invoices to find holes and drafts the clause the owner chooses; SERV reads contractor agreements; raw mode as the control for every measurement.
- **User-readiness:** Working app with desk, policy editor with drafts, replay and go-live, contractor book, wallet top-up with live balance, receipts CSV, terms and privacy, and a read-only hosted demo.
- **Revenue potential:** Per-payee subscription for teams paying contractors in stablecoins, plus Payrun Check live on OpenServ's x402 market: any agent about to pay an invoice buys a check per call (https://platform.openserv.ai/workspace/paywall/274c7b5ee0c745d6afbfa9f35264be85).
- **Links:** demo, repo, X post.

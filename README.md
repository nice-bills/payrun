# Payrun

**Pay contractors by the book.** Write your payment policy in plain English. Payrun reads every invoice against it with SERV Reasoning, shows you where your wording leaks, and makes the paying wallet obey it too.

OpenServ SERV Hackathon, Edition 01 · AgentKit track · Base Sepolia (testnet)

## The problem

A small company pays 5–30 contractors in USDC. Every month a pile of invoices arrives as PDFs, emails and chat messages. Some are wrong: a reissued duplicate, padded days, an expense nobody approved. Some are attacks: a "my wallet was frozen, pay this new address" email, or a PDF with an instruction hidden in white 1pt text for whatever AI reads it. Business email compromise cost US businesses $3.05B in 2025 (FBI IC3).

## What happens to an invoice

1. **SERV Prompt Guard reads it first, alone.** The invoice is written by the person who gains from fooling the reviewer, so an injected instruction is refused before any model sees it (0 tokens billed).
2. **Code checks the facts** that must never be guessed: sums, day cap, rate, wallet on file, invoices already on file. It states what passed as well as what failed, and it can only make a verdict stricter.
3. **SERV Reasoning applies the policy.** The written policy is the system prompt; SERV compiles it into a bounded reasoning graph (Kronos audit + Multipath), cached per version, and a small model (`gpt-6-luna`) walks it for each invoice with a per-invoice Shadow Agent hint. Every verdict cites clauses and quotes evidence.
4. **The wallet enforces the same limits.** Approved invoices are paid through Coinbase AgentKit from a CDP wallet whose account policy allows USDC `transfer` only to contractor-book wallets, up to each agreement's monthly maximum. The signer refused a direct transfer to the scammer's address and an over-cap transfer in testing. The payroll wallet is the company's own (created under its Coinbase developer account); one more rule lets it send back to the owner's wallet, the one it was topped up from, so the owner can always withdraw and nobody else can.

## The pay run is an agent

**Run payroll** hands the unpaid pile to a SERV agent that holds the payroll wallet. The policy is its system prompt (compiled once per version with Kronos + Multipath), and it acts through tools that SERV forwards alongside its own `serv_shadow_agent` marker:

| Tool | What runs | Who can refuse |
|---|---|---|
| `check_balance` | AgentKit's ERC-20 `get_balance` on the payroll wallet | |
| `pay_invoice` | AgentKit's ERC-20 `transfer` to the wallet on file (the model never supplies an address) | Payrun's code checks (hard facts, exact total), then Coinbase's signer (wallet rules) |
| `hold_invoice` / `block_invoice` | Records the decision with cited clauses and quoted evidence | Code can only make it stricter |

Every refusal goes back to the model as a tool result, and it must hold or block rather than retry. This follows SERV's Day One guidance: the model judges and picks the next action, tools do exact work and validate their arguments, and credentials are least-privilege. On the Payouts page each step shows who acted: SERV, Payrun, AgentKit or the signer. `npm run cli -- payroll --dry` runs it with no wallet.

## Scam Payrun: try to scam the agent

`/arena` is a public challenge. Anyone pays a small x402 entry on OpenServ, becomes a contractor on file (100 USDC a day, 5-day cap), and sends any invoice. The arena policy approves no work this month, so the right answer is always "don't pay". If the agent pays you, you keep it (at most 0.5 test USDC, enforced by Coinbase's signer on a separate arena wallet). Each attempt runs the real pipeline, and the public board records which layer caught it: Prompt Guard, Payrun's checks, SERV, or the signer. Invoice text is never published. Limits: 100 attempts a day, 5 per wallet (`ARENA_DAILY_LIMIT`, `ARENA_WALLET_DAILY_LIMIT`), because SERV credit is real even when the entry fee is test USDC.

The board outlives the container: every attempt is also pushed to a Redis list (Upstash REST, or Vercel KV), a redeployed container restores from it before taking entries, and `/arena` renders on the server from the most durable source that answers (the store, local runs, the live container, then `demo/arena-board.json` from `npm run cli -- arena snapshot`). Demo with no keys: `npm run demo:board`.

**The house red team** (`src/agentkit/redTeam.ts`) attacks it with the same stack: SERV writes one invoice per tactic (hidden instruction, fake approval, padded days, expense dressed as work, wallet swap, authority, policy-lawyering, rate drift) against the arena's written policy, and an AgentKit wallet pays each entry fee over x402 and asks to be paid to itself. Every result goes on the public board. `npm run demo:redteam` shows the loop offline; `npm run cli -- redteam [--tactics a,b] --go` runs it for real (entry fees in USDC on Base from `PAYRUN_REDTEAM_WALLET`).

Setup: `npm run cli -- arena setup` (creates the arena wallet and its cap rule), fund it with test USDC and a little Base Sepolia ETH, then `npm run openserv:deploy`. Local attempt: `npm run cli -- arena try --wallet 0x… --file invoice.txt`.

## Payrun Check, sold per call on OpenServ

`openserv/agent.ts` publishes the review as an x402 service on OpenServ's agent market: another agent sends its own policy, an invoice and the payee's terms, pays per call in USDC on Base, and gets PAY / HOLD / BLOCK with cited clauses. Same pipeline (`src/core/check.ts`): SERV reads the terms, Prompt Guard screens the invoice, code checks the facts, SERV applies the caller's policy. Set `PAYRUN_EARNINGS_WALLET` to receive payments in your own wallet, then `npm run openserv` (its first run signs up for OpenServ with a new wallet and prints the paywall URL). Live: [Payrun Check paywall](https://platform.openserv.ai/workspace/paywall/274c7b5ee0c745d6afbfa9f35264be85), $0.05 per check.

### For any AgentKit agent: `payrun_check_invoice`

`src/agentkit/payrunCheck.ts` is an AgentKit action provider. An agent that is about to pay an invoice adds it next to its other providers and gets `payrun_check_invoice`: it sends its policy, the invoice verbatim and the payee's terms, pays Payrun Check's x402 price from its own AgentKit wallet, and gets PAY / HOLD / BLOCK with cited clauses.

```ts
const agentkit = await AgentKit.from({
  walletProvider,
  actionProviders: [erc20ActionProvider(), payrunCheckActionProvider({ maxPriceUsdc: 0.1 })],
});
```

The wallet signs only what Payrun Check asked for: USDC on Base, up to `maxPriceUsdc`, to `payTo` if set (an x402 payment policy, checked before anything is signed). `npm run demo:check` runs it offline against a local x402 endpoint that verifies the EIP-3009 signature and runs the real check pipeline; `--live` pays the real Payrun Check on OpenServ (0.05 USDC on Base from a CDP wallet; set `PAYRUN_CHECK_URL` if the trigger URL changes).

## Where SERV sits

| Surface | SERV feature |
|---|---|
| Invoice intake | Prompt Guard on the extraction call |
| Verdicts | Policy-as-system-prompt, Kronos + Multipath, Shadow Agent with a per-invoice hint |
| Policy editor | SERV reviews the wording on every save (conflicts, undefined terms, ambiguity, missing cases) with one-click fixes |
| Holes in the policy | SERV writes boundary invoices, judges each three times, and surfaces cases the wording leaves to the reviewer; the owner picks a reading, SERV drafts the clause, replay shows what changes before it goes live |
| Contractor book | SERV reads a pasted agreement into a draft card the owner confirms |
| Pay run | SERV agent with AgentKit tools (`tool_choice: required`, one action per turn), Shadow Agent on each decision |
| For other agents | Payrun Check on OpenServ's x402 market |
| Controls | Raw mode (`x-openserv-disable-braid`) as the comparison arm for every measurement |
| Audit trail | Every SERV call keeps its `x-openserv-request-id`: on the verdict card, on each SERV step of a pay run, in the receipts CSV (`serv_request_ids`) and in every Payrun Check reply (`servRequestIds`), so any verdict can be looked up in the OpenServ console |

## Measured, not claimed

From recorded runs in this repo (`/proof` in the app):

- 40 generated invoices, 24 traps: every setup (SERV + luna, raw luna, raw gpt-5.4) caught all 24 once code states the facts.
- The hidden-text PDF was blocked by the guard before the model read it.
- 4 holes found in the 7-clause v1 policy; the wording review flagged 3 of them independently.
- On ambiguous invoices, each setup flipped on 1 of 4. A bigger model doesn't settle loose wording; a clause does, which is why every hole becomes a decision for the owner.

## Run it

```bash
npm install
cp .env.example .env        # SERV_API_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
npm run cli -- init && npm run cli -- ingest
npm run dev                 # http://localhost:3100
```

Useful CLI commands: `run` (decide the pile), `gaps`, `replay`, `wallet fund|apply|address`, `pay`, `attack`, `receipts`. Tests: `npm test`.

### Hosted demo (no keys, no credit)

`PAYRUN_DEMO=1` serves a read-only snapshot (`demo/`) with recorded SERV responses (`fixtures/cassettes/`). Reviews replay recorded verdicts; anything that would spend credit or move money explains itself instead. Refresh the snapshot with `npm run demo:snapshot`.

## Honest limits

- Testnet only. Invoices settle at a disclosed 1/1000 scale so a faucet covers a month.
- SERV's compiled graph is private; the app shows its own clause view, not SERV's graph.
- SERV does not report Shadow Agent outcomes per response, so Payrun cannot force a HOLD when validation is exhausted.
- A new policy's first compile takes about a minute; cached versions answer in seconds.
- See `DESIGN.md` for the details and `PRODUCT.md` for the product brief.

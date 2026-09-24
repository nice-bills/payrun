# Payrun — design

**One line:** write your contractor payment policy in plain English; Payrun compiles it with SERV, finds its holes, and enforces it on every invoice — and on the wallet itself.

Track: AgentKit (OpenServ SERV Hackathon, Edition 01). Network: Base Sepolia only.

## The split

| Layer | Owns | Can it be talked out of it? |
|---|---|---|
| Code (`checks.ts`) | Arithmetic, address book, day cap, rate, exact duplicates | No — hard findings only make a verdict stricter |
| SERV (`decide.ts`) | Messy text → fields; applying the policy; near-duplicates, scope, expenses, social engineering | This is where the attack lands, and where SERV is measured |
| Wallet (`walletPolicy.ts`) | USDC `transfer` only, only to address-book wallets, only up to each agreement max | No — enforced by Coinbase's signer |

## How SERV is used

- **The policy is the system prompt.** `judgmentSystemPrompt()` is byte-stable per policy version and holds no invoice data, so SERV compiles one reasoning graph per version and caches it (30 days, per org). `policy.hash` = sha256 of that prompt = the version fingerprint on every decision.
- **Kronos + Multipath** (`gpt-5.4-nano-serv-kronos-multipath`): audited, branch-aware graph for a rule set with exceptions; a nano model walks it.
- **Prompt Guard** on extraction and judgment: the invoice is written by the party who gains from fooling the reviewer. A guard refusal → BLOCK, the model never saw the invoice.
- **Shadow Agent** with a per-invoice hint naming the facts the verdict must address (hint lives in `tools`, so it does not break the policy cache).
- **Raw mode** (`x-openserv-disable-braid`) is the control arm for every comparison: same model, same prompts, SERV off.
- **Gap finder** (`gaps.ts`): SERV writes boundary invoices; each is judged 3×; a flip, an uncited verdict, or `policy_covers=false` is a gap; SERV drafts a one-line clause to close it.
- **Replay** (`replay.ts`): a new policy version re-decides past invoices (fields reused) and lists flips before the version goes live.

## Honest limits

- SERV's compiled graph is private (its content filter blocks it). We show our clause view, not SERV's graph.
- Testnet settles at a disclosed 1/1000 scale (`PAYRUN_SETTLEMENT_SCALE`), applied to transfers and wallet caps alike.
- Costs are estimates from catalog prices × returned tokens; the console is the source of truth.

## Proof

`npx tsx eval/run.ts` — 40 generated invoices (16 clean, 24 traps across 7 kinds) through `serv`, `rawNano`, `rawBig`. Scored twice: the model's own verdict (what SERV changes) and the final verdict after invariants (what Payrun does). Injection and unapproved-expense traps are invisible to code checks; only the judgment step can catch them.

## Run

```bash
cp .env.example .env   # SERV + CDP keys
npm run cli -- init && npm run cli -- ingest
npx tsx scripts/spike.ts          # verifies SERV guard/shadow/kronos behaviour
npm run cli -- run                 # decide all invoices (SERV)
npm run cli -- run --mode rawNano  # same, SERV bypassed
npm run cli -- gaps                # find policy holes
npm run cli -- wallet fund && npm run cli -- wallet apply
npm run cli -- pay && npm run cli -- attack && npm run cli -- receipts
```

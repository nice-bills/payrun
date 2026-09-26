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
- **Kronos + Multipath** (`gpt-6-luna-serv-kronos-multipath`): audited, branch-aware graph for a rule set with exceptions; a small, cheap model walks it (`PAYRUN_MODEL`).
- **Prompt Guard** on extraction, where the payee's text arrives alone: the invoice is written by the party who gains from fooling the reviewer. A guard refusal (zero tokens billed, `refusal` set or `finish_reason: content_filter`) → BLOCK before any judgment. Spike 24 Sep: guarding the judgment call instead false-blocked 2 of 4 clean invoices, because that user turn also carries our own agreement/facts; guarding extraction passed all clean invoices and still blocked the hidden-text PDF.
- **Shadow Agent** with a per-invoice hint naming the facts the verdict must address (hint lives in `tools`, so it does not break the policy cache).
- **Raw mode** (`x-openserv-disable-braid`) is the control arm for every comparison: same model, same prompts, SERV off.
- **Gap finder** (`gaps.ts`): SERV writes boundary invoices; each is judged 3×; a flip, an uncited verdict, or `policy_covers=false` is a gap; SERV drafts a one-line clause to close it.
- **Replay** (`replay.ts`): a new policy version re-decides past invoices (fields reused) and lists flips before the version goes live.

## Honest limits

- SERV's compiled graph is private (its content filter blocks it). We show our clause view, not SERV's graph.
- Testnet settles at a disclosed 1/1000 scale (`PAYRUN_SETTLEMENT_SCALE`), applied to transfers and wallet caps alike.
- Returned token counts do not include SERV's own feature calls (reasoning-prompt generation, Kronos audit, guard judge, shadow validator). ~30 calls on 24 Sep spent ~$4.26, about 100× the token estimate. The console Usage page is the only real cost figure.
- SERV does not report Shadow Agent outcomes per response (only `x-openserv-request-id`), so Payrun cannot force HOLD when validation is exhausted; outcomes are in the console's Shadow Agent report.

- SERV pre-checks each request's worst-case cost against the balance, and in practice wants ~$0.50 of headroom per request (observed: estimate $0.74 at balance $0.74, $0.51 at $0.51, $0.48 at $0.47) even though requests cost ~$0.008 each (console). Below ~$0.50 balance, nothing runs.

## Recorded SERV responses

`PAYRUN_SERV_CASSETTE=auto` saves every live SERV response to `fixtures/cassettes/` (keyed by the exact request) and replays it afterwards for free. `npm run demo:replay` rebuilds the whole 11-invoice demo from recordings with no API key, into `data/replay.db`. The recorded demo runs on `gpt-6-luna`, the default small model (`PAYRUN_MODEL`). The older `gpt-5.4-nano` recordings predate the confirmed-facts lines in the judgment request, so they no longer match it.

## Status (24 Sep)

| Piece | Built | Run live |
|---|---|---|
| Decide (extract + guard, checks, judgment + shadow) | ✓ | ✓ 11/11 demo invoices correct |
| Guard vs hidden-text PDF | ✓ | ✓ blocked |
| AgentKit payouts under CDP policy | ✓ | ✓ 4 paid; attacker + over-cap refused by signer |
| Receipts CSV | ✓ | ✓ |
| Gap finder | ✓ | probes generated (4 real gaps); judging runs need credit |
| Policy v2 + replay | ✓ | needs credit |
| 40-invoice proof (serv / raw-small / raw-gpt-5.4) | ✓ | needs credit (~$1) |

## Proof

`npx tsx eval/run.ts` — 40 generated invoices (16 clean, 24 traps across 7 kinds) through `serv`, `rawSmall`, `rawBig`. Scored twice: the model's own verdict (what SERV changes) and the final verdict after invariants (what Payrun does). Injection and unapproved-expense traps are invisible to code checks; only the judgment step can catch them.

## Run

```bash
cp .env.example .env   # SERV + CDP keys
npm run cli -- init && npm run cli -- ingest
npx tsx scripts/spike.ts          # verifies SERV guard/shadow/kronos behaviour
npm run cli -- run                 # decide all invoices (SERV)
npm run cli -- run --mode rawSmall  # same, SERV bypassed
npm run cli -- gaps                # find policy holes
npm run cli -- wallet fund && npm run cli -- wallet apply
npm run cli -- pay && npm run cli -- attack && npm run cli -- receipts
```

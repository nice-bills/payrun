# Product

## Register

product

## Users

A founder or ops lead at a small company that pays 5–30 contractors in USDC. Once a month, usually on a laptop in daylight, they clear a pile of invoices that arrive as PDFs, emails and chat messages, and want to be done in minutes and sure nothing fishy went out. They are not accountants and not crypto engineers. Secondary audience: hackathon judges (OpenServ SERV Hackathon, AgentKit track) who see it for two minutes in a demo video and a live link.

## Product Purpose

Payrun turns a company's written payment policy into an enforced control. SERV Reasoning compiles the policy and applies it to every invoice with cited clauses; code checks the exact facts; the same limits are compiled into the paying wallet so Coinbase's signer refuses anything outside them. Success: the user writes the policy once, drops in the month's invoices, sees which to pay and why, pays with one action, and gets receipts; the policy's own holes are surfaced as decisions for them to make.

## Brand Personality

Tactile, exact, a little wry. The product is an accounts-payable desk: paper invoices, rubber stamps, a red pen in the margin, a typed policy memo. It should feel like a well-kept desk, not a trading terminal. Voice is plain and specific: say what was checked and what was found.

## Anti-references

- Dark "terminal" or crypto-dashboard UIs (neon on black, monospace everywhere, glowing charts). Explicitly rejected by the user.
- Generic SaaS dashboards: hero-metric tiles, identical card grids, gradient accents.
- Wordy compliance tools with every field open and instruction text everywhere (the user called a previous UI like that "slop").

## Design Principles

- One focal thing per screen: one invoice, one policy memo, one pay run. Everything else is peripheral.
- Show the evidence, not a summary of it: the verdict points at the words in the invoice that decided it.
- Motion only answers a question: "did that register?", "where am I?", "is it working?". The rubber stamp is the one earned flourish, and only when a verdict is fresh.
- Honest about the machine: say when something is replayed, estimated, testnet, or scaled.
- Cut copy first. If a label can be a stamp, a number or a highlight, it is.

## Accessibility & Inclusion

WCAG 2.2 AA. The primary user has ADHD: minimal text, instant unambiguous feedback on every input, no state where it is unclear whether the app is working, no decorative motion. Verdicts never rely on colour alone (stamp word + colour + position). Full `prefers-reduced-motion` support. Keyboard navigation through the invoice list.

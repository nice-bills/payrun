/**
 * Payrun Check on OpenServ: the invoice review sold per call over x402.
 *
 * Another agent (or a person on the paywall page) sends a payment policy, an
 * invoice and the payee's terms, pays the x402 price in USDC on Base, and gets
 * back PAY / HOLD / BLOCK with the deciding clauses and quoted evidence. The
 * work is Payrun's own pipeline on SERV Reasoning: Prompt Guard on the invoice,
 * code checks on the facts, the policy compiled with Kronos + Multipath and a
 * Shadow Agent check. Nothing is paid out; this is the check only.
 *
 * First run (you, not a script on your behalf): `npm run openserv`. provision()
 * signs up with a fresh wallet, registers the agent, creates the x402 workflow
 * and prints the paywall URL. Keep the process running to serve calls, or
 * deploy it with `npx @openserv-labs/client deploy`.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { Agent, run } from "@openserv-labs/sdk";
import { provision, triggers } from "@openserv-labs/client";
import { z } from "zod";
import { ArenaLog, runArenaAttempt, validateEntry, ARENA_POLICY, type ArenaEntry } from "../src/core/arena";
import { checkInvoice } from "../src/core/check";
import { ServClient } from "../src/core/serv";

const PRICE = process.env.PAYRUN_CHECK_PRICE_USD ?? "0.05";

const agent = new Agent({
  systemPrompt:
    "You are Payrun Check. For every request, call check_invoice exactly once with the caller's payment policy, invoice text and payee terms, then return its JSON result unchanged.",
});

agent.addCapability({
  name: "check_invoice",
  description:
    "Check a contractor invoice against a written payment policy before paying it. Returns PAY, HOLD or BLOCK with the deciding clauses, quoted evidence and code-checked facts (rate, day cap, wallet on file, sums). Blocks invoices that carry instructions aimed at the reviewer.",
  inputSchema: z.object({
    policy: z.string().describe("The payment policy, ideally numbered clauses."),
    invoice: z.string().describe("The invoice text, as received."),
    terms: z.string().optional().describe("The payee's agreement or email: name, wallet on file, day rate, monthly day cap, scope."),
  }),
  async run({ args, action }) {
    const serv = new ServClient({ traceDir: null });
    const result = await checkInvoice(serv, args);
    if (action?.type === "do-task" && action.task) {
      await this.addLogToTask({
        workspaceId: action.workspace.id,
        taskId: action.task.id,
        severity: "info",
        type: "text",
        body: `Payrun Check: ${result.verdict} after ${result.servRequests} SERV Reasoning requests${result.blockedByGuard ? " (Prompt Guard refused the invoice)" : ""}.`,
      });
    }
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Scam Payrun. Enabled when the container has an arena wallet (PAYRUN_ARENA_WALLET)
 * and CDP keys. The board is public at /arena/board, registered before the SDK's
 * auth middleware (like /health), with no invoice text in it.
 */
const ARENA = !!process.env.PAYRUN_ARENA_WALLET;
const arenaLog = new ArenaLog(process.env.ARENA_LOG ?? "data/arena.json");
let queue: Promise<unknown> = Promise.resolve();
/** One attempt at a time: a single wallet, so transfers never race for a nonce. */
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
};

/** The caller's own fields, untouched by the platform's runtime model when they arrive as JSON. */
function rawEntry(action: unknown): Partial<ArenaEntry> | null {
  const a = action as { type?: string; task?: { input?: string | null } } | undefined;
  const raw = a?.type === "do-task" ? a.task?.input : null;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return j && typeof j === "object" && typeof j.invoice === "string" ? j : null;
  } catch {
    return null;
  }
}

if (ARENA) {
  const app = (agent as unknown as { app: { get: (p: string, h: (req: unknown, res: any) => void) => void } }).app;
  app.get("/arena/board", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store");
    res.json(arenaLog.board());
  });

  agent.addCapability({
    name: "scam_attempt",
    description:
      "Scam Payrun challenge entry. Runs the challenger's invoice through Payrun's AI payroll agent, which holds a real wallet. Returns whether the agent paid, and which defence caught the attempt.",
    inputSchema: z.object({
      wallet: z.string().describe("The challenger's Base Sepolia wallet, where a payout would go."),
      invoice: z.string().describe("The challenger's invoice, verbatim. Pass it through exactly as given."),
      handle: z.string().optional().describe("X handle for the board."),
    }),
    async run({ args, action }) {
      const entry = { ...args, ...(rawEntry(action) ?? {}) } as ArenaEntry;
      const invalid = validateEntry(entry);
      if (invalid) return JSON.stringify({ error: invalid });
      const limited = arenaLog.refusal(entry.wallet);
      if (limited) return JSON.stringify({ error: limited });
      return serial(async () => {
        const { createAgentKitPayer } = await import("../src/core/pay");
        const wallet = await createAgentKitPayer({ address: process.env.PAYRUN_ARENA_WALLET });
        const attempt = await runArenaAttempt(new ServClient({ traceDir: null }), wallet, entry);
        arenaLog.add(attempt);
        const { steps, ...shown } = attempt;
        return JSON.stringify(
          {
            result: attempt.caughtBy ? `Caught by ${attempt.caughtBy}. The agent did not pay.` : `You won: the agent paid you ${attempt.paidUsdc} test USDC.`,
            ...shown,
            steps: steps.map((s) => `${s.actor}: ${s.title}. ${s.detail}`),
            board: process.env.ARENA_BOARD_URL ?? null,
          },
          null,
          2,
        );
      });
    },
  });
}

async function main() {
  // The deployed copy must reuse the provisioned identity, never sign up a new account.
  if (process.env.PAYRUN_REQUIRE_OPENSERV_STATE === "1" && !existsSync(".openserv.json")) {
    throw new Error(".openserv.json is missing, so provision() would create a new OpenServ account. Rebuild with npm run openserv:build.");
  }
  const result = await provision({
    agent: {
      instance: agent,
      name: "payrun-check",
      description: "Checks contractor invoices against your written payment policy with SERV Reasoning before you pay.",
    },
    workflow: {
      name: "Payrun Check",
      goal: "Check a contractor invoice against the caller's written payment policy and the payee's terms, using SERV Reasoning with Prompt Guard, code-verified facts and cited clauses, and return a PAY, HOLD or BLOCK verdict with evidence before any money moves.",
      trigger: triggers.x402({
        name: "Payrun Check",
        description: "Should you pay this invoice? PAY / HOLD / BLOCK against your own policy, with cited clauses and evidence. Hidden instructions in the invoice are blocked.",
        price: PRICE,
        timeout: 600,
        ...(process.env.PAYRUN_EARNINGS_WALLET ? { walletAddress: process.env.PAYRUN_EARNINGS_WALLET } : {}),
        input: {
          policy: { type: "string", title: "Payment policy", description: "Your rules, one numbered clause per line." },
          invoice: { type: "string", title: "Invoice", description: "Paste the invoice text." },
          terms: { type: "string", title: "Payee terms", description: "Wallet on file, day rate, monthly day cap, scope." },
        },
      }),
      task: { description: "Run check_invoice on the caller's policy, invoice and terms and return the verdict JSON." },
    },
  });
  console.log(`Payrun Check is listed at ${PRICE} USD per call.`);
  if (ARENA) {
    const arena = await provision({
      agent: { instance: agent, name: "payrun-check", description: "Checks contractor invoices against your written payment policy with SERV Reasoning before you pay." },
      workflow: {
        name: "Scam Payrun",
        goal: "Public challenge: a challenger sends an invoice to Payrun's AI payroll agent, which holds a real testnet wallet and a policy that approves no work this month. The agent must refuse; if it pays, the challenger keeps the payment. Returns the verdict and which defence caught the attempt.",
        trigger: triggers.x402({
          name: "Scam Payrun",
          description: `We gave an AI payroll agent a wallet. Send it any invoice. If it pays you, you keep it. Policy: ${ARENA_POLICY.split("\n")[1].slice(3)}`,
          price: process.env.ARENA_FEE_USD ?? "0.05",
          timeout: 600,
          ...(process.env.PAYRUN_EARNINGS_WALLET ? { walletAddress: process.env.PAYRUN_EARNINGS_WALLET } : {}),
          input: {
            wallet: { type: "string", title: "Your wallet (Base Sepolia)", description: "Where the agent would pay you." },
            invoice: { type: "string", title: "Your invoice", description: "Anything you like. Try to get paid." },
            handle: { type: "string", title: "X handle (optional)", description: "For the board." },
          },
        }),
        task: { description: "Call scam_attempt with the challenger's wallet, invoice (verbatim) and handle, and return its JSON result unchanged." },
      },
    });
    console.log(`Scam Payrun is open. Paywall: ${arena.paywallUrl ?? "(see platform)"}`);
  }
  if (result.paywallUrl) console.log(`Paywall: ${result.paywallUrl}`);
  console.log(`Workflow ${result.workflowId}, agent ${result.agentId}.`);
  await run(agent);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

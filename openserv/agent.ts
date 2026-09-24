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
import { Agent, run } from "@openserv-labs/sdk";
import { provision, triggers } from "@openserv-labs/client";
import { z } from "zod";
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

async function main() {
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
  if (result.paywallUrl) console.log(`Paywall: ${result.paywallUrl}`);
  console.log(`Workflow ${result.workflowId}, agent ${result.agentId}.`);
  await run(agent);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

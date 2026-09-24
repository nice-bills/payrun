import { config } from "dotenv"; config({ quiet: true, path: "/home/bills/.config/Claude/scratch-workspaces/eca05e3c-c2bf-40b5-be28-6bea94b7a59e/67692826-253c-4e66-8f7f-b57b8e9f85b2/scratch-2026-09-24-fc36ae/.env" });
import { readFileSync } from "node:fs";
import { ServClient } from "../../src/core/serv.js";
import { extractFields, readInvoiceText } from "../../src/core/extract.js";
import { JUDGMENT_SCHEMA, judgmentUserMessage } from "../../src/core/decide.js";
import { judgmentSystemPrompt, makePolicyVersion } from "../../src/core/policy.js";
import { matchContractor, runChecks } from "../../src/core/checks.js";
process.chdir("/home/bills/.config/Claude/scratch-workspaces/eca05e3c-c2bf-40b5-be28-6bea94b7a59e/67692826-253c-4e66-8f7f-b57b8e9f85b2/scratch-2026-09-24-fc36ae");
const serv = new ServClient({ traceDir: "/tmp/claude-1000/-home-bills--config-Claude-scratch-workspaces-eca05e3c-c2bf-40b5-be28-6bea94b7a59e-67692826-253c-4e66-8f7f-b57b8e9f85b2-scratch-2026-09-24-fc36ae/e4ad3b23-3183-46fc-96e1-91f163c0746b/scratchpad/traces" });
const contractors = JSON.parse(readFileSync("fixtures/contractors.json", "utf8"));
const policy = makePolicyVersion(readFileSync("fixtures/policy.v1.md", "utf8"), 1);
const files = ["02-kwame-clean.txt", "04-yaw-original.txt", "01-ama-clean.txt", "10-kwame-expense-injected.pdf"];
const variant = (m: string) => m.replace("FACTS (computed by code; treat as true)", "FACTS").replace("EXTRACTED FIELDS", "EXTRACTED");
for (const f of files) {
  const text = await readInvoiceText("fixtures/invoices/" + f);
  const ex = await extractFields(serv, text, { model: "gpt-5.4-nano", guard: true }, "exp-extract");
  const line = [f.padEnd(32), "A:extract-guard=" + (ex.meta.guardBlocked ? "BLOCK" : "pass")];
  if (ex.fields) {
    const c = matchContractor(ex.fields, contractors);
    const msg = variant(judgmentUserMessage({ id: f, source: f, rawText: text, receivedAt: "" }, ex.fields, c, runChecks(ex.fields, c, [])));
    for (let i = 0; i < 2; i++) {
      const r = await serv.call({ model: "gpt-5.4-nano", features: ["kronos", "multipath"], guard: true, system: judgmentSystemPrompt(policy.clauses), user: msg, schema: { name: "payment_judgment", schema: JUDGMENT_SCHEMA as any }, label: "exp-judge" });
      line.push("B" + (i + 1) + "=" + (r.meta.guardBlocked ? "BLOCK" : (r.parsed as any)?.verdict));
    }
  }
  console.log(line.join("  "));
}

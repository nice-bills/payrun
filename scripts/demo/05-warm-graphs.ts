/**
 * Demo 5: going live compiles SERV's graphs straight away, so the first invoice
 * under new wording is answered in seconds instead of about a minute.
 *
 *   npx tsx scripts/demo/05-warm-graphs.ts           # offline: a local endpoint that compiles like SERV (6 s)
 *   npx tsx scripts/demo/05-warm-graphs.ts --serve   # keep it up on :8078 for the app (SERV_BASE_URL=http://127.0.0.1:8078)
 *   npm run cli -- policy live <v>                   # live: switch and warm with real SERV
 */
import { readFileSync } from "node:fs";
import { makePolicyVersion } from "../../src/core/policy";
import { ServClient } from "../../src/core/serv";
import { warmPolicy } from "../../src/core/warm";
import { fakeServEndpoint, head, line } from "./kit";

const serve = process.argv.includes("--serve");
const serv$ = await fakeServEndpoint(6000, serve ? 8078 : 0);
if (serve) {
  line(`SERV stand-in on ${serv$.url} (first request per system prompt waits 6 s). Ctrl-C to stop.`);
} else {
  const serv = new ServClient({ apiKey: "demo", baseUrl: serv$.url, traceDir: null, cassetteMode: "off" });
  const policy = makePolicyVersion(readFileSync("fixtures/policy.v2.md", "utf8"), 2);
  head(`Policy v2 goes live: warm SERV's two graphs`);
  const r = await warmPolicy(serv, policy, (m) => line(`  ${m}`), 2000);
  head("Going live again with the same wording (already compiled)");
  const again = await warmPolicy(serv, policy, (m) => line(`  ${m}`), 2000);
  line(`\nFirst: ${r.graphs.map((g) => `${g.name} ${(g.ms / 1000).toFixed(1)}s`).join(", ")} · again: ${again.graphs.map((g) => `${g.name} ${(g.ms / 1000).toFixed(1)}s${g.cached ? " (cached)" : ""}`).join(", ")}`);
  await serv$.close();
}

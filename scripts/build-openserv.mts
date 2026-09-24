/**
 * Build a small, self-contained package for OpenServ Cloud:
 *   openserv/deploy/src/agent.ts   the agent + Payrun's check code, bundled
 *   openserv/deploy/package.json   only what the bundle imports
 *   openserv/deploy/.env           ONLY the keys the check needs (no CDP keys)
 *   openserv/deploy/.openserv.json the provisioned identity, so the container reuses it
 * OpenServ's deploy skips only what the folder's own .gitignore lists, so the
 * .env here is uploaded on purpose. The folder itself is git-ignored.
 * Then: npx @openserv-labs/client deploy openserv/deploy
 */
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

const out = "openserv/deploy";
mkdirSync(`${out}/src`, { recursive: true });
await build({ entryPoints: ["openserv/agent.ts"], bundle: true, platform: "node", format: "esm", packages: "external", outfile: `${out}/src/agent.ts`, logLevel: "warning" });

const root = JSON.parse(readFileSync("package.json", "utf8"));
const deps = ["@openserv-labs/client", "@openserv-labs/sdk", "dotenv", "tsx", "unpdf", "viem", "zod"];
// Peers the SDK needs at runtime; legacy-peer-deps won't install them on its own.
const peers: Record<string, string> = { openai: "^7.23.0" };
const pick = (n: string) => root.dependencies?.[n] ?? root.devDependencies?.[n];
writeFileSync(
  `${out}/package.json`,
  JSON.stringify({ name: "payrun-check", private: true, type: "module", scripts: { start: "tsx src/agent.ts" }, engines: { node: ">=20" }, dependencies: { ...Object.fromEntries(deps.map((n) => [n, pick(n) ?? "latest"])), ...peers } }, null, 2) + "\n",
);
writeFileSync(`${out}/.gitignore`, "node_modules\n");
// Same as the app: the OpenServ SDK still declares zod 3 peers; it runs fine on zod 4.
writeFileSync(`${out}/.npmrc`, "legacy-peer-deps=true\n");

const env = parse(readFileSync(".env"));
const keep = ["SERV_API_KEY", "SERV_BASE_URL", "PAYRUN_MODEL", "PAYRUN_CHECK_PRICE_USD", "PAYRUN_EARNINGS_WALLET", "SERV_COST_PER_REQUEST_USD", "WALLET_PRIVATE_KEY", "OPENSERV_USER_API_KEY", "OPENSERV_API_KEY", "OPENSERV_AUTH_TOKEN", "OPENSERV_CONTAINER_ID"];
const lines = keep.filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
if (!env.SERV_API_KEY) throw new Error("SERV_API_KEY missing from .env");
if (!existsSync(".openserv.json")) throw new Error("Run `npm run openserv` once first so the agent is provisioned.");
const state = JSON.parse(readFileSync(".openserv.json", "utf8"));
if (!env.OPENSERV_USER_API_KEY && state.userApiKey) lines.push(`OPENSERV_USER_API_KEY=${state.userApiKey}`);
// Keep the container id the first deploy writes, so re-deploys reuse the same container.
const prev = existsSync(`${out}/.env`) ? parse(readFileSync(`${out}/.env`)) : {};
if (!env.OPENSERV_CONTAINER_ID && prev.OPENSERV_CONTAINER_ID) lines.push(`OPENSERV_CONTAINER_ID=${prev.OPENSERV_CONTAINER_ID}`);
lines.push("PAYRUN_REQUIRE_OPENSERV_STATE=1");
writeFileSync(`${out}/.env`, lines.join("\n") + "\n", { mode: 0o600 });
copyFileSync(".openserv.json", `${out}/.openserv.json`);
console.log(`Built ${out}: ${lines.map((l) => l.split("=")[0]).join(", ")}`);

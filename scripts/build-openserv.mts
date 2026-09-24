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
import { agentkitLite } from "../openserv/lite/plugin.mjs";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

const out = "openserv/deploy";
// Start clean so files from older builds (lockfile, .npmrc) are not shipped.
for (const f of ["package-lock.json", ".npmrc"]) rmSync(`${out}/${f}`, { force: true });
mkdirSync(`${out}/src`, { recursive: true });
// Everything in one file: the container has 1 GB of RAM, too little for npm to install AgentKit's
// full tree, and AgentKit's index loads every integration it ships. The agentkit-lite plugin keeps
// only the CDP EVM wallet provider and the ERC-20 actions Payrun uses.
await build({
  entryPoints: ["openserv/agent.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  outfile: `${out}/src/agent.mjs`,
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  plugins: [agentkitLite],
  logLevel: "warning",
});

// OpenServ starts `npx tsx src/agent.ts`. tsx compiles its entry in memory, and a 9 MB bundle
// runs the 1 GB container out of memory, so the entry is a launcher that runs the bundle on plain node.
writeFileSync(
  `${out}/src/agent.ts`,
  `import { spawn } from "node:child_process";\nconst child = spawn(process.execPath, ["src/agent.mjs"], { stdio: "inherit", env: process.env });\nfor (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => child.kill(s));\nchild.on("exit", (code) => process.exit(code ?? 1));\n`,
);
const root = JSON.parse(readFileSync("package.json", "utf8"));
const tsx = root.devDependencies?.tsx ?? root.dependencies?.tsx ?? "latest";
// The entrypoint OpenServ runs is `npx tsx src/agent.ts`; the bundle needs nothing else.
writeFileSync(`${out}/package.json`, JSON.stringify({ name: "payrun-check", private: true, type: "module", scripts: { start: "tsx src/agent.ts" }, engines: { node: ">=20" }, dependencies: { tsx } }, null, 2) + "\n");
writeFileSync(`${out}/.gitignore`, "node_modules\n");

const env = parse(readFileSync(".env"));
const arena = !!process.env.PAYRUN_ARENA_WALLET || /^PAYRUN_ARENA_WALLET=0x/m.test(readFileSync(".env", "utf8"));
const keep = [
  // Scam Payrun drives its own arena wallet, so the container needs CDP keys. The payroll wallet
  // (PAYRUN_WALLET_ADDRESS) is deliberately not passed.
  ...(arena ? ["PAYRUN_ARENA_WALLET", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "PAYRUN_SETTLEMENT_SCALE", "ARENA_FEE_USD", "ARENA_DAILY_LIMIT", "ARENA_WALLET_DAILY_LIMIT", "ARENA_BOARD_URL"] : []),
  "SERV_API_KEY", "SERV_BASE_URL", "PAYRUN_MODEL", "PAYRUN_CHECK_PRICE_USD", "PAYRUN_EARNINGS_WALLET", "SERV_COST_PER_REQUEST_USD", "WALLET_PRIVATE_KEY", "OPENSERV_USER_API_KEY", "OPENSERV_API_KEY", "OPENSERV_AUTH_TOKEN", "OPENSERV_CONTAINER_ID"];
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

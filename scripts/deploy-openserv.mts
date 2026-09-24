/**
 * Deploy openserv/deploy (one bundled file + env) to the OpenServ Cloud container.
 * Same steps as `npx @openserv-labs/client deploy` (upload, npm install, start or
 * restart, go live), adapted to what the endpoint accepts: large request bodies
 * answer 500 and bursts get refused, so the archive goes up in parts, with retries,
 * and is joined in the container. Long commands run in the background because the
 * orchestrator sits behind Cloudflare's 120 s timeout.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";

const dir = "openserv/deploy";
const require = createRequire(import.meta.url);
const { ApiClient } = require("@openserv-labs/client/dist/deploy/api-client.js");
const env = parse(readFileSync(`${dir}/.env`));
if (!env.OPENSERV_USER_API_KEY || !env.OPENSERV_CONTAINER_ID) throw new Error("Run npm run openserv:build first (needs OPENSERV_USER_API_KEY and a container id from the first deploy).");
const c = new ApiClient({ apiKey: env.OPENSERV_USER_API_KEY });
const id = env.OPENSERV_CONTAINER_ID;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const tar = (args: string) => execSync(`tar czf - ${args}`, { maxBuffer: 1 << 28 });
const run = async (cmd: string, timeout = 100) => {
  const r = await c.exec(id, ["sh", "-c", cmd], timeout);
  if (r.exitCode !== 0) throw new Error(`${cmd.slice(0, 60)}… failed (${r.exitCode}): ${(r.stderr || r.stdout || "").slice(-600)}`);
  return r.stdout as string;
};
/** Run in the background inside the container and poll a marker file. */
async function background(cmd: string, label: string, limitS = 900) {
  await run(`cd /app && rm -f bg.done bg.log && (nohup sh -c '${cmd} > bg.log 2>&1; echo $? > bg.done' > /dev/null 2>&1 &)`);
  for (let waited = 0; waited < limitS; waited += 10) {
    await sleep(10);
    const done = (await run("cat /app/bg.done 2>/dev/null || true")).trim();
    if (done === "0") return;
    if (done) throw new Error(`${label} failed (${done}): ${(await run("tail -20 /app/bg.log")).slice(-800)}`);
  }
  throw new Error(`${label} still running after ${limitS}s`);
}

const status = await c.getStatus(id).catch(() => null);
console.log(`Container ${id}: ${status?.status ?? "unknown"}`);
const publicUrl = `https://${status?.appName ?? `container-${id}`}.fly.dev`;

// Upload the archive in parts: start at 64 KB, halve when the endpoint keeps refusing.
// --skip-upload resumes after a finished upload (e.g. when only the install failed).
const skipUpload = process.argv.includes("--skip-upload");
const all = tar(`--exclude=node_modules -C ${dir} .`);
const tmp = mkdtempSync(join(tmpdir(), "payrun-deploy-"));
let size = 64 * 1024;
let offset = 0;
let n = 0;
console.log(`Uploading ${(all.length / 1024).toFixed(0)} KB…`);
await run("rm -f /app/pkg.part*");
if (skipUpload) offset = all.length;
while (offset < all.length) {
  const name = `pkg.part${String(n).padStart(4, "0")}`;
  const chunk = all.subarray(offset, offset + size);
  writeFileSync(join(tmp, name), chunk);
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    try {
      await c.upload(id, tar(`-C ${tmp} ${name}`));
      ok = true;
    } catch {
      await sleep(10 + attempt * 15);
    }
  }
  if (!ok) {
    if (size <= 8 * 1024) throw new Error("The upload endpoint refuses even 8 KB parts right now. Try again later.");
    size = Math.floor(size / 2);
    console.log(`  refused; parts are now ${size / 1024} KB`);
    continue;
  }
  offset += chunk.length;
  n++;
  if (n % 10 === 0) console.log(`  ${((offset / all.length) * 100).toFixed(0)}%`);
  await sleep(1);
}
if (!skipUpload) {
  await run(`cd /app && cat pkg.part* | tar xzf - && rm pkg.part* && rm -f package-lock.json .npmrc && wc -c src/agent.ts`);
  console.log(`Uploaded in ${n} parts.`);
}

console.log("Installing (tsx only)…");
// Fresh node_modules: the bundle needs only tsx, and a half-finished install from an older package breaks npm.
await background("rm -rf node_modules package-lock.json && npm install --no-audit --no-fund --omit=dev", "npm install");

const before = await fetch(`${publicUrl}/health`).then((r) => r.json()).catch(() => null);
if (!status?.status || status.status === "ready") await c.start(id);
else await c.restart(id);
if (status?.status !== "live") await c.goLive(id, "continuous");

// Wait for the new process: /health uptime resets, and the arena board answers.
for (let i = 0; i < 30; i++) {
  await sleep(5);
  const h = await fetch(`${publicUrl}/health`).then((r) => r.json()).catch(() => null);
  if (h && (!before || h.uptime < before.uptime)) {
    const board = await fetch(`${publicUrl}/arena/board`).then((r) => r.status).catch(() => 0);
    console.log(`Live at ${publicUrl} (uptime ${Math.round(h.uptime)}s, arena board ${board})`);
    process.exit(0);
  }
}
console.log(`Restarted, but ${publicUrl}/health has not come back yet. Check again in a minute.`);

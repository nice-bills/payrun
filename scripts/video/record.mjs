// npm run build && npx next start --port 3100, then: node scripts/video/record.mjs out/take && python3 scripts/video/cut.py out/take out/payrun-demo.mp4
// Records the Payrun demo from the running app: one continuous CDP screencast at 1920x1080,
// with shot boundaries logged so the cutter can drop page loads.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
mkdirSync(`${OUT}/frames`, { recursive: true });

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1920 / 1440 });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);

const frames = [];
let n = 0;
cdp.on("Page.screencastFrame", async (f) => {
  const file = `${OUT}/frames/${String(n++).padStart(6, "0")}.jpg`;
  writeFileSync(file, Buffer.from(f.data, "base64"));
  frames.push({ t: f.metadata.timestamp, file });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

// Captions and a cursor, drawn into the page so they are in the frames.
const OVERLAY = () => {
  if (document.getElementById("__cap")) return;
  const s = document.createElement("style");
  s.textContent = `
    #__cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;
      background:oklch(0.27 0.07 255);color:oklch(0.96 0.015 90);font-family:var(--font-schibsted),system-ui,sans-serif;
      font-weight:800;font-size:25px;line-height:1.3;letter-spacing:-0.01em;padding:12px 22px;border-radius:4px;
      box-shadow:3px 4px 0 oklch(0.18 0.06 258);text-align:center;transition:opacity .25s ease;opacity:0;pointer-events:none}
    #__cap.on{opacity:1}
    #__cap small{display:block;font-family:var(--font-courier),ui-monospace,monospace;font-weight:400;font-size:15px;opacity:.8;margin-top:4px;letter-spacing:0}
    #__cur{position:fixed;z-index:2147483647;width:26px;height:26px;pointer-events:none;left:-40px;top:-40px;transition:transform .08s}
    #__cur.down{transform:scale(.85)}`;
  document.head.appendChild(s);
  const c = document.createElement("div"); c.id = "__cap"; document.body.appendChild(c);
  const k = document.createElement("div"); k.id = "__cur";
  k.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.5 L14.2 20.3 L11.2 13.8 L17.5 13.6 Z" fill="#14264f" stroke="#faf8f2" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(k);
  addEventListener("mousemove", (e) => { k.style.left = e.clientX - 3 + "px"; k.style.top = e.clientY - 2 + "px"; }, true);
  addEventListener("mousedown", () => k.classList.add("down"), true);
  addEventListener("mouseup", () => k.classList.remove("down"), true);
};
await ctx.addInitScript(`addEventListener("DOMContentLoaded", ${OVERLAY.toString()})`);

const cap = (text, sub = "") =>
  p.evaluate(([t, s]) => {
    const c = document.getElementById("__cap");
    if (!c) return;
    if (!t) return c.classList.remove("on");
    c.innerHTML = t + (s ? `<small>${s}</small>` : "");
    c.classList.add("on");
  }, [text, sub]);
const wait = (ms) => p.waitForTimeout(ms);
const now = async () => (await cdp.send("Runtime.evaluate", { expression: "0" }), Date.now() / 1000);
const shots = [];
let cursor = { x: 720, y: 400 };
const move = async (x, y, steps = 25) => { await p.mouse.move(x, y, { steps }); cursor = { x, y }; };
const moveTo = async (loc, dx = 0.5, dy = 0.5) => {
  const bb = await loc.boundingBox();
  await move(bb.x + bb.width * dx, bb.y + bb.height * dy);
};
const scrollBy = async (dy, ms = 900) => {
  await p.evaluate(([d, t]) => new Promise((r) => {
    const el = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 400) ?? document.scrollingElement;
    const from = el.scrollTop, t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / t); el.scrollTop = from + d * (1 - Math.pow(1 - k, 3)); k < 1 ? requestAnimationFrame(step) : r(); };
    requestAnimationFrame(step);
  }), [dy, ms]);
};
const inboxTo = (loc) => loc.evaluate((e) => {
  let el = e.parentElement;
  while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  if (el) el.scrollTop += e.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 2;
});
const sheetsToTop = () => p.evaluate(() => {
  for (const el of document.querySelectorAll("main, article, section, div")) if (!el.closest('[aria-label="Invoices this month"]') && el.scrollTop) el.scrollTop = 0;
  window.scrollTo(0, 0);
});
async function shot(name, fn) {
  const start = Date.now() / 1000;
  await fn();
  shots.push({ name, start, end: Date.now() / 1000 });
  console.log(name, (Date.now() / 1000 - start).toFixed(1) + "s");
}
async function go(path) {
  await cap("");
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.mouse.move(cursor.x, cursor.y);
}

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// Title card on the app's own paper and fonts.
await go("/");
await p.evaluate(() => {
  document.body.innerHTML = `<div class="cork" style="position:fixed;inset:0;display:grid;place-items:center">
    <div style="text-align:center;color:var(--color-ink)">
      <div style="font-family:var(--font-schibsted);font-weight:900;font-size:120px;letter-spacing:-0.05em;line-height:1">Payrun</div>
      <div style="font-family:var(--font-caveat);font-size:44px;color:var(--color-pen);margin-top:10px">pay contractors by the book</div>
      <div style="font-family:var(--font-courier);font-size:16px;margin-top:34px">SERV Reasoning · Coinbase AgentKit · Base Sepolia · OpenServ SERV Hackathon</div>
    </div></div>`;
});
await wait(400);
await shot("title", () => wait(3200));

// 1. The hero: the stamp lands, the hidden line shows itself.
await go("/");
await p.addStyleTag({ content: ".cork > section:first-of-type{min-height:100vh}" });
await shot("hero", async () => {
  await wait(300);
  await cap("An invoice with one extra line, in 1pt white type:", "orders for whatever AI reads it");
  await move(1000, 440, 30);
  await wait(4200);
  await cap("Payrun blocked it before any model read a word.", "SERV Prompt Guard · zero tokens billed");
  await wait(3600);
});

// 2. The pile, in miniature.
await shot("pile", async () => {
  await cap("");
  await p.evaluate(() => document.querySelector('section[aria-label="A pay run in miniature"]').scrollIntoView({ behavior: "smooth" }));
  await wait(1200);
  await move(40, 780, 20); // out of the way: hovering pauses it
  await cap("Every invoice meets four layers. The first one that objects decides.", "SERV's guard · Payrun's code checks · SERV Reasoning · Coinbase's signer");
  await wait(8200);
  await cap("A clean invoice passes all four and gets paid.", "an illustration; the rest of this video is the real app");
  await wait(4800);
});

// 3. The desk: the PDF with hidden text.
await go("/desk");
await shot("desk-pdf", async () => {
  await wait(700);
  const pdf = p.locator('[aria-label="Invoices this month"] button').filter({ hasText: "PDF" }).first();
  await pdf.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await wait(400);
  await moveTo(pdf);
  await cap("On the desk, each invoice gets a verdict against the company's written policy.");
  await wait(1200);
  await pdf.click();
  await wait(300);
  await sheetsToTop();
  await wait(1900);
  const reveal = p.getByRole("button", { name: "Reveal what the model was fed" });
  await moveTo(reveal);
  await cap("SERV's Prompt Guard refused this PDF before any model read it.");
  await wait(1600);
  await reveal.click();
  await wait(1000);
  await cap("Here is why: an instruction to the AI reviewer, invisible on the page.");
  await wait(4200);
});

// 4. A verdict that cites the clause and points at the words.
await shot("desk-akosua", async () => {
  const ak = p.locator('[aria-label="Invoices this month"] button', { hasText: "Akosua" }).first();
  await ak.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await wait(400);
  await moveTo(ak);
  await cap("");
  await wait(500);
  await ak.click();
  await wait(300);
  await sheetsToTop();
  await wait(1100);
  await cap("Every verdict cites the clause and points at the words that decided it.");
  const notes = p.locator('[aria-label="Reviewer\'s notes"] li');
  const c = await notes.count();
  for (let i = 0; i < Math.min(c, 2); i++) {
    await moveTo(notes.nth(i), 0.4, 0.4);
    await wait(2300);
  }
  if (c < 2) await wait(3000);
});

// 5. The policy's holes.
await go("/policy");
await shot("policy", async () => {
  await wait(800);
  await cap("SERV also writes invoices aimed at the policy's own wording, to find its holes.");
  const note = p.locator("text=Which do you mean?").first();
  if (await note.count()) await moveTo(note, 0.3, 0.5);
  await wait(3800);
  const reading = p.locator("text=A request and confirmation sent from the email").first();
  if (await reading.count()) await moveTo(reading, 0.4, 0.5);
  await cap("Where the wording leaves it open, the owner picks what they meant.", "SERV drafts the clause; replay shows what would change before it goes live");
  await wait(5200);
});

// 6. The agent runs payroll through AgentKit (the recorded real run, replayed).
await go("/payouts");
await shot("payroll", async () => {
  await wait(800);
  const run = p.getByRole("button", { name: /Run payroll/ });
  await moveTo(run);
  await cap("Then SERV runs payroll itself, through Coinbase AgentKit.");
  await wait(1800);
  await run.click();
  await wait(1500);
  await cap("It reads the wallet balance, pays what the policy allows and holds the rest.", "a replay of a real run on Base Sepolia");
  await move(40, 780, 20);
  let paidShown = false, t0 = Date.now(), n = 0;
  while (Date.now() - t0 < 32000) {
    await wait(450);
    const state = await p.evaluate(() => {
      const sheets = [...document.querySelectorAll('section[aria-label="Pay run"] > ol > li')];
      const last = sheets.at(-1);
      last?.scrollIntoView({ block: "end", behavior: "smooth" });
      const tx = document.querySelector('section[aria-label="Pay run"] a[href*="basescan"]');
      const busy = [...document.querySelectorAll("button")].some((b) => b.textContent.includes("working"));
      return { tx: !!tx, busy, count: sheets.length };
    });
    if (state.tx && !paidShown) {
      paidShown = true;
      const tx = p.locator('section[aria-label="Pay run"] a[href*="basescan"]').first();
      await tx.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "smooth" }));
      await wait(500);
      await moveTo(tx);
      await cap("Efua's invoice passes: the agent pays her through AgentKit and the signer approves.", "1.5 test USDC · tx 0xe68c…26ad");
      await wait(4200);
      await move(40, 780, 15);
      await cap("The rest are held for a wallet top-up, or blocked.");
    }
    if (++n === 12 && !paidShown) await cap("Every step shows who acted: SERV, Payrun's checks, AgentKit, or Coinbase's signer.");
    if (!state.busy && state.count > 3) break;
  }
  await wait(1200);
});

// 6b. The receipt with the on-chain transaction.
await shot("receipt", async () => {
  await cap("Every payment prints a receipt, with the transaction and the SERV request ids.");
  await p.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.includes("Receipts"));
    h?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await wait(4800);
});

// 7. The wallet's own rules.
await shot("rules", async () => {
  const tags = p.locator('aside[aria-label="Wallet rules"]');
  await moveTo(tags.locator("h2").first(), 0.3, 0.5);
  await cap("The wallet carries the same rules, enforced by Coinbase's signer.", "only wallets in the contractor book, never above an agreement's cap");
  await wait(5200);
});

// 8. The public challenge.
await go("/arena");
await shot("arena", async () => {
  await wait(900);
  await cap("So we made it public. Send Payrun any invoice. If it pays you, you keep it.");
  await wait(4200);
  await scrollBy(520, 1200);
  await cap("Every attempt shows which layer caught it.", "Scam Payrun · paid entry over x402 on OpenServ");
  await wait(5000);
});

// End card.
await go("/");
await p.evaluate(() => {
  document.body.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;background:var(--color-band)">
    <div style="text-align:center;color:var(--color-on-band)">
      <div style="font-family:var(--font-schibsted);font-weight:900;font-size:96px;letter-spacing:-0.05em;line-height:1">Payrun</div>
      <div style="font-family:var(--font-schibsted);font-weight:800;font-size:34px;margin-top:18px">Try to scam it: <span style="color:var(--color-marker)">payrun-app.vercel.app/arena</span></div>
      <div style="font-family:var(--font-courier);font-size:17px;margin-top:30px;color:var(--color-on-band-2)">Built on SERV Reasoning and Coinbase AgentKit · github.com/nice-bills/payrun</div>
    </div></div>`;
});
await wait(400);
await shot("end", () => wait(4200));

await cdp.send("Page.stopScreencast");
writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ frames, shots }, null, 1));
console.log(frames.length, "frames");
await b.close();

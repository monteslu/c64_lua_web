// ui-drive.mjs — end-to-end through the REAL UI in headless Chromium:
//   gallery -> clone an example -> Play -> emulator renders; a syntax error
//   gates Play and shows in Problems; the tabs render; the .d64 downloads.
// Run: node test/ui-drive.mjs  (starts vite dev internally)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = "5284";

const viteBin = path.join(HERE, "node_modules", ".bin", "vite");
const vite = spawn(viteBin, ["--port", PORT, "--strictPort"], {
  cwd: HERE, stdio: ["ignore", "pipe", "pipe"], detached: true,
});
const killVite = () => { try { process.kill(-vite.pid, "SIGTERM"); } catch { try { vite.kill(); } catch { /* gone */ } } };
let viteOut = "";
vite.stdout.on("data", (d) => { viteOut += d; });
vite.stderr.on("data", (d) => { viteOut += d; });
const ready = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 30000);
  const iv = setInterval(() => { if (new RegExp(`localhost:${PORT}`).test(viteOut.replace(/\x1b\[[0-9;]*m/g, ""))) { clearTimeout(t); clearInterval(iv); resolve(true); } }, 200);
});
if (!ready) { killVite(); throw new Error("vite dev did not start:\n" + viteOut); }

let failed = false;
const pass = (m) => console.log("PASS:", m);
// Dump the dev server's output on the FIRST failure. Vite announces a
// mid-run re-optimize here ("new dependencies optimized: X" / "reloading"),
// which is the real cause behind a generic "Execution context was destroyed".
// Without this the log is silent about it and the bug looks like a flake.
let dumped = false;
const fail = (m) => {
  failed = true;
  console.error("FAIL:", m);
  if (!dumped) { dumped = true; console.error("--- VITE OUTPUT ---\n" + viteOut.slice(-3000)); }
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__c64luaWeb, { timeout: 15000 });

  // 1. the gallery lists the staged examples
  await page.waitForSelector(".gallery-card", { timeout: 10000 });
  const cardCount = await page.locator(".gallery-card").count();
  cardCount >= 4 ? pass(`gallery shows ${cardCount} examples`) : fail(`gallery has too few cards (${cardCount})`);

  // 2. clone "hello" into a project
  await page.locator(".gallery-card", { hasText: "hello" }).first().click();
  await page.waitForSelector(".monaco-editor", { timeout: 15000 });
  const src = await page.evaluate(() => window.__c64luaWeb.getSource?.() ?? "");
  src.length > 0 ? pass("cloned hello into a project (editor mounted)") : fail("cloned project has no source");

  // 3. wait for the toolchain to warm, then Play
  await page.waitForFunction(() => {
    const b = document.querySelector(".play-btn");
    return b && !b.disabled;
  }, { timeout: 120000 });
  pass("toolchain warmed, Play enabled");

  console.log("Play (first build compiles the cc65 wasm)…");
  await page.locator(".play-btn").click();
  await page.waitForFunction(() => /running/.test(document.querySelector(".emu-status")?.textContent || ""), { timeout: 120000 });
  pass("build finished and the disk booted on VICE");

  // The .d64 autostarts like a real drive: KERNAL, LOAD"*",8,1, RUN. At 50fps
  // PAL that is a good ~40s of wall clock before the game's own output appears,
  // so poll for a THIRD color rather than asserting on a fixed short wait — the
  // blue boot screen is only 2 colors and would otherwise pass for the game.
  const rendered = await page.waitForFunction(() => {
    const c = document.querySelector(".emu-screen");
    if (!c) return null;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    return seen.size >= 3 ? { sum, colors: seen.size, w: c.width, h: c.height } : null;
  }, { timeout: 120000, polling: 1000 }).then((h) => h.jsonValue()).catch(() => null);
  rendered
    ? pass(`emulator renders the game (${rendered.w}x${rendered.h}, ${rendered.colors} colors, pixel sum ${rendered.sum})`)
    : fail("game never reached the screen (still on the disk boot screen?)");

  // 4. a syntax error gates Play + shows in Problems
  await page.evaluate(() => window.__c64luaWeb.setSource?.("function _draw(\n  cls(1)\n"));
  await page.waitForTimeout(600);
  const playDisabled = await page.evaluate(() => document.querySelector(".play-btn")?.disabled);
  playDisabled ? pass("syntax error disables Play") : fail("Play still enabled with a syntax error");
  const problemCount = await page.locator(".problems li.error").count();
  problemCount > 0 ? pass(`error shows in Problems (${problemCount})`) : fail("no error in Problems panel");

  await page.evaluate(() => window.__c64luaWeb.setSource?.("function _draw()\n  cls(3)\nend\n"));
  await page.waitForTimeout(500);
  const reEnabled = await page.evaluate(() => !document.querySelector(".play-btn")?.disabled);
  reEnabled ? pass("Play re-enables once fixed") : fail("Play stayed disabled after fixing");

  // 5. the editor tabs render without crashing
  for (const [tab, sel] of [
    ["Pixels", ".sprite-editor,.sprite-empty"],
    ["Palette", ".palette-pane"],
    ["Cheatsheet", ".cheatsheet"],
  ]) {
    await page.locator(".tab", { hasText: tab }).click();
    try {
      await page.waitForSelector(sel, { timeout: 8000 });
      pass(`${tab} tab renders`);
    } catch { fail(`${tab} tab did not render (${sel})`); }
  }

  // 5b. the palette inserts a C64 color index at the cursor
  await page.locator(".tab", { hasText: "Palette" }).click();
  await page.waitForSelector(".c64-swatch", { timeout: 8000 });
  const beforeLen = await page.evaluate(() => window.__c64luaWeb.getSource?.().length ?? 0);
  await page.locator(".c64-swatch").nth(7).click();
  await page.waitForTimeout(400);
  const afterLen = await page.evaluate(() => window.__c64luaWeb.getSource?.().length ?? 0);
  afterLen > beforeLen ? pass("palette swatch inserts a color index") : fail("palette insert did not change source");

  // 6. the built disk image downloads as a .d64 (the headline artifact)
  await page.locator(".tab", { hasText: "Code" }).click();
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.locator("button", { hasText: ".d64" }).click();
  const download = await dl;
  const name = download.suggestedFilename();
  /\.d64$/.test(name) ? pass(`disk image downloads (${name})`) : fail(`download had an unexpected name: ${name}`);
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  killVite();
}

if (failed) process.exit(1);
console.log("all UI gates green");

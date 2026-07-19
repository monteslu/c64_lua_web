// browser-build.mjs — the acceptance gates, in a REAL browser:
//   1. BYTE-IDENTICAL .prg: build hello in the browser worker (actual WASM
//      cc65), build the same source with the c64lua CLI, assert equal bytes.
//   2. BYTE-IDENTICAL .d64: the autostart disk image the browser wraps must
//      match `c64lua build --d64` exactly — it is the headline artifact, and it
//      runs c64lua's own 1541 writer rather than a second implementation.
//   3. BOOT SMOKE: run the browser-built .d64 on VICE and assert the screen is
//      not blank.
//   4. A SECOND EXAMPLE: plasma, byte-identical too — one example passing could
//      be luck with a trivial cart.
// Run: node test/browser-build.mjs   (starts vite dev internally)
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const C64LUA = path.dirname(require.resolve("c64lua/package.json"));
const CLI = path.join(C64LUA, "bin", "c64lua.js");
const PORT = "5283";

const source = await readFile(path.join(C64LUA, "examples", "hello", "main.lua"), "utf8");
const plasmaSource = await readFile(path.join(C64LUA, "examples", "plasma", "main.lua"), "utf8");

// ── CLI reference builds (the byte-identity baselines) ───────────────────────
const work = await mkdtemp(path.join(tmpdir(), "c64lua-web-test-"));

/** Build one source with the CLI; returns { prg, d64 }. */
async function cliBuild(name, src) {
  const srcPath = path.join(work, `${name}.lua`);
  const prgPath = path.join(work, `${name}.prg`);
  const d64Path = path.join(work, `${name}.d64`);
  await writeFile(srcPath, src);
  execFileSync("node", [CLI, "build", srcPath, "-o", prgPath, "--d64", d64Path], { stdio: "pipe" });
  return { prg: await readFile(prgPath), d64: await readFile(d64Path) };
}

const cliHello = await cliBuild("hello", source);
console.log(`CLI hello: ${cliHello.prg.length} byte .prg, ${cliHello.d64.length} byte .d64`);
const cliPlasma = await cliBuild("plasma", plasmaSource);
console.log(`CLI plasma: ${cliPlasma.prg.length} byte .prg, ${cliPlasma.d64.length} byte .d64`);

// ── start vite dev ───────────────────────────────────────────────────────────
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
  const iv = setInterval(() => {
    if (new RegExp(`localhost:${PORT}`).test(viteOut.replace(/\x1b\[[0-9;]*m/g, ""))) { clearTimeout(t); clearInterval(iv); resolve(true); }
  }, 200);
});
if (!ready) { killVite(); throw new Error("vite dev did not start:\n" + viteOut); }

let failed = false;
const pass = (m) => console.log("PASS:", m);
const fail = (m) => { failed = true; console.error("FAIL:", m); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page]", m.text()); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__c64luaWeb, { timeout: 15000 });

  // The CLI names the disk after the OUTPUT FILE (hello.prg -> label HELLO), so
  // the browser must be told the same name or the directory entry differs and
  // the .d64 comparison fails on the label bytes alone.
  console.log("building hello in the browser (first build compiles the cc65 wasm)…");
  const r = await page.evaluate((src) => window.__c64luaWeb.build(src, { name: "hello" }), source);
  if (!r.ok) throw new Error("browser build failed:\n" + r.log);
  const webPrg = Buffer.from(r.prgBase64, "base64");
  const webD64 = Buffer.from(r.d64Base64, "base64");
  console.log(`browser hello: ${webPrg.length} byte .prg, ${webD64.length} byte .d64 (${r.ms}ms)`);

  // gate 1: the .prg
  webPrg.equals(cliHello.prg)
    ? pass("browser .prg is byte-identical to the CLI .prg")
    : fail(`browser .prg differs from the CLI .prg (${webPrg.length} vs ${cliHello.prg.length} bytes)`);

  // gate 2: the .d64
  webD64.equals(cliHello.d64)
    ? pass("browser .d64 is byte-identical to the CLI --d64 image")
    : fail(`browser .d64 differs from the CLI .d64 (${webD64.length} vs ${cliHello.d64.length} bytes)`);

  // gate 3: boot smoke on VICE, from the disk image (the autostart path).
  //
  // Frame budget matters here in a way it does not on a cartridge machine. The
  // .d64 boots like a real disk: KERNAL start, then LOAD"*",8,1 off a simulated
  // 1541, then RUN. Until that finishes the screen shows the blue BASIC boot
  // screen — which is 2 colors and NOT blank, so a lenient smoke test passes on
  // the boot screen and would keep passing if the game never loaded at all.
  // Measured: the boot screen holds through ~1800 frames and the game's own
  // output appears by ~2100. Run past that and require a THIRD color, which
  // only the game can put there.
  const SMOKE_FRAMES = 2400;
  const smoke = await page.evaluate(
    ({ b64, n }) => window.__c64luaWeb.bootSmoke(b64, n),
    { b64: r.d64Base64, n: SMOKE_FRAMES },
  );
  if (smoke.pixelSum <= 0 || smoke.colors < 3) {
    fail(`game did not reach the screen after ${SMOKE_FRAMES} frames — still on the boot screen? (${JSON.stringify(smoke)})`);
  } else {
    pass(`game renders past the disk boot (${smoke.width}x${smoke.height}, ${smoke.colors} colors, pixel sum ${smoke.pixelSum})`);
  }

  // gate 4: a second, heavier example
  console.log("building plasma in the browser…");
  const r2 = await page.evaluate((src) => window.__c64luaWeb.build(src, { name: "plasma" }), plasmaSource);
  if (!r2.ok) throw new Error("browser plasma build failed:\n" + r2.log);
  const pPrg = Buffer.from(r2.prgBase64, "base64");
  const pD64 = Buffer.from(r2.d64Base64, "base64");
  console.log(`browser plasma: ${pPrg.length} byte .prg, ${pD64.length} byte .d64 (${r2.ms}ms)`);
  pPrg.equals(cliPlasma.prg)
    ? pass("plasma browser .prg is byte-identical to the CLI .prg")
    : fail(`plasma .prg differs (${pPrg.length} vs ${cliPlasma.prg.length} bytes)`);
  pD64.equals(cliPlasma.d64)
    ? pass("plasma browser .d64 is byte-identical to the CLI --d64 image")
    : fail(`plasma .d64 differs (${pD64.length} vs ${cliPlasma.d64.length} bytes)`);
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  killVite();
  await rm(work, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("all browser gates green");

// build-worker.js — the browser build, off the UI thread.
//
// It calls c64lua's REAL build() (the identical pipeline the CLI drives) over
// an in-memory VFS, so the browser produces the same .prg as `c64lua build` —
// no reimplementation, which is what the byte-identity gate asserts. The .d64
// wrap then runs c64lua's own 1541 writer over that .prg, so the disk image
// matches `--d64` byte for byte too.
//
// build() drives the tools SYNCHRONOUSLY (its run()/cc()/as() calls don't
// await). WASM instantiation is only async at COMPILE time, so we compile the
// three cc65/ca65/ld65 modules once at worker startup (async, warm), then each
// tool run is `new WebAssembly.Instance` — synchronous — via the lib's
// runWasmTool. That is what lets env.runTool satisfy build() unchanged.
//
// Protocol: main posts { type:"build", id, source, opts }; worker posts back
// { type:"progress"|"done"|"error", id, ... }.

import { build } from "c64lua/build";
import { runWasmTool, createVfsEnv, fnv1aHex } from "luacretro-web/build";
import { installBufferShim } from "./buffer-shim.js";

// c64lua's d64.mjs is written for node and allocates with Buffer. Install the
// shim BEFORE importing it, so the module sees a working Buffer at call time.
installBufferShim();

// Load the .d64 writer LAZILY, never with a top-level await.
//
// A top-level await makes this an async module: everything after it — including
// the `self.onmessage = ...` assignment at the bottom — runs only once the
// await settles. A `build` or `warm` message that arrives before then hits a
// worker with NO message handler installed, and the browser drops it silently.
// The client's promise then never settles and the whole IDE looks hung, with no
// error anywhere. (That is exactly what it did.) Registering the handler
// synchronously and awaiting the import at the point of USE keeps the worker
// responsive from its first tick.
let writeD64Promise = null;
const getWriteD64 = () => {
  if (!writeD64Promise) writeD64Promise = import("c64lua/bin/d64.mjs").then((m) => m.writeD64);
  return writeD64Promise;
};

const GLUE_BASE = "/cc65/wasm";
const SHARE_BASE = "/cc65/share";
const SDK_BASE = "/sdk";
const SHARE_SUBS = ["include", "asminc", "lib", "cfg"];

const enc = new TextEncoder();

// ---- warm caches (loaded/compiled once, reused for the worker's life) -------
const moduleCache = new Map();   // tool -> WebAssembly.Module (compiled)
const shareCache = new Map();    // subdir -> Map<vfsPath, Uint8Array>
// cc65/ca65 are deterministic and the SDK runtime units are invariant (the
// editor cannot change them), yet build() recompiles them every time. Caching
// on flags + source bytes makes every build after the first compile the game
// unit only.
const compileCache = new Map();
let sdkFiles = null;
let shareManifest = null;

async function compileTool(tool) {
  if (moduleCache.has(tool)) return moduleCache.get(tool);
  const bytes = await (await fetch(`${GLUE_BASE}/${tool}.wasm`)).arrayBuffer();
  const mod = await WebAssembly.compile(bytes);
  moduleCache.set(tool, mod);
  return mod;
}

async function loadShareSub(sub) {
  if (shareCache.has(sub)) return shareCache.get(sub);
  if (!shareManifest) shareManifest = await (await fetch(`${SHARE_BASE}/manifest.json`)).json();
  const files = new Map();
  await Promise.all((shareManifest[sub] ?? []).map(async (rel) => {
    files.set(`/cc65/${sub}/${rel}`, new Uint8Array(await (await fetch(`${SHARE_BASE}/${sub}/${rel}`)).arrayBuffer()));
  }));
  shareCache.set(sub, files);
  return files;
}

async function loadSdkRuntime() {
  if (sdkFiles) return sdkFiles;
  const list = await (await fetch(`${SDK_BASE}/manifest.json`)).json();
  const files = new Map();
  await Promise.all(list.files.map(async (rel) => {
    files.set(`${SDK_BASE}/${rel}`, new Uint8Array(await (await fetch(`${SDK_BASE}/${rel}`)).arrayBuffer()));
  }));
  sdkFiles = files;
  return files;
}

/** Warm everything the build needs BEFORE build() runs, so runTool can be sync. */
async function warmup() {
  await Promise.all([
    compileTool("cc65"), compileTool("ca65"), compileTool("ld65"),
    ...SHARE_SUBS.map(loadShareSub),
    loadSdkRuntime(),
  ]);
}

/** A disk label: PETSCII-ish, <=16 chars. The CLI derives it from the filename. */
const diskLabel = (name) => (name || "GAME").replace(/\.prg$/i, "").toUpperCase().slice(0, 16);

/**
 * Build a Lua game to a .prg (+ .d64) in the browser via c64lua's real build().
 * @param {string} source
 * @param {object} opts { num8?, dev?, name?, __id }
 */
async function buildProgram(source, opts = {}) {
  const t0 = performance.now();
  const progress = (msg) => postMessage({ type: "progress", id: opts.__id, msg: String(msg) });
  progress("warming tools");
  await warmup();

  // build() routes real compile/link diagnostics through env.warn just before
  // it throws a terse "<tool> failed (exit N)" — keep the last few so the UI
  // can show WHY, not just THAT, a build failed.
  const diag = [];

  const vfs = new Map(sdkFiles);
  // Pre-mount the whole cc65 share tree so build()'s `env.exists(asminc)` guard
  // (checked before any tool runs) sees it, and every tool finds its files.
  for (const sub of SHARE_SUBS) for (const [p, bytes] of shareCache.get(sub)) vfs.set(p, bytes);
  vfs.set("/work/main.lua", enc.encode(source));

  // SYNCHRONOUS tool runner with a cross-build compile cache. Each cc65/ca65
  // call is `[...flags, -o <dst>, <src>]` with ONE primary input, so the output
  // is a pure function of (flags, source bytes) — cache on exactly that. ld65
  // is NOT cached (many varying .o inputs, and it is already fast).
  const runTool = (tool, args) => {
    const cacheable = tool === "cc65" || tool === "ca65";
    let cacheKey = null;
    const oi = args.indexOf("-o");
    if (cacheable && oi >= 0) {
      const dst = args[oi + 1];
      const src = args[args.length - 1];
      const srcBytes = vfs.get(src);
      if (dst && srcBytes) {
        const flagArgs = args.filter((_, i) => i !== oi && i !== oi + 1);
        cacheKey = tool + "\x1f" + flagArgs.join("\x1f") + "\x1f" + fnv1aHex(srcBytes);
        const hit = compileCache.get(cacheKey);
        if (hit) { vfs.set(dst, hit.out); return { status: hit.status, stdout: "", stderr: hit.stderr }; }
      }
    }
    let stderr = "";
    const status = runWasmTool(moduleCache.get(tool), {
      fs: vfs, argv: [tool, ...args], print: () => {}, printErr: (s) => { stderr += s + "\n"; },
    });
    // strip ANSI so any downstream regex over tool output matches native
    const cleanErr = stderr.replace(/\x1b\[[0-9;]*m/g, "");
    if (cacheKey && status === 0) {
      const out = vfs.get(args[oi + 1]);
      if (out) compileCache.set(cacheKey, { out, status, stderr: cleanErr });
    }
    return { status, stdout: "", stderr: cleanErr };
  };

  const env = createVfsEnv({
    vfs, runTool,
    sdk: SDK_BASE,
    lib: "/cc65/lib/c64.lib",
    asminc: "/cc65/asminc",
    log: (m) => progress(m),
    warn: (m) => { const s = String(m).trim(); if (s) { diag.push(s); if (diag.length > 8) diag.shift(); } },
  });

  const outPath = "/work/game.prg";
  try {
    // c64lua's build() is SYNCHRONOUS (unlike neslua's) — it returns, not awaits.
    build("/work/main.lua", { out: outPath, num8: !!opts.num8, dev: !!opts.dev }, env);
  } catch (err) {
    const detail = diag.join("\n").trim();
    if (detail) err.message = `${err.message}\n${detail}`;
    throw err;
  }

  const prg = vfs.get(outPath);
  if (!prg) throw new Error("build produced no .prg");
  // the autostart disk image, from c64lua's own 1541 writer
  const writeD64 = await getWriteD64();
  const d64 = new Uint8Array(writeD64(prg, diskLabel(opts.name)));

  return { ok: true, prg, d64, ms: Math.round(performance.now() - t0) };
}

// Kick warmup off the moment the worker exists (page load), so the tools are
// compiled and the share/SDK trees fetched BEFORE the first Play.
const warmPromise = warmup().catch((err) => { self.__warmErr = err; });

self.onmessage = async (e) => {
  const { type, id, source, opts } = e.data;
  if (type === "warm") {
    try { await warmPromise; postMessage({ type: "warm-done", id }); }
    catch (err) { postMessage({ type: "warm-done", id, error: String(err) }); }
    return;
  }
  if (type !== "build") return;
  try {
    const result = await buildProgram(source, { ...opts, __id: id });
    // Dedupe the transfer list: .prg comes out of the VFS and .d64 is a fresh
    // allocation today, but if they ever shared a backing ArrayBuffer, naming
    // it twice would make postMessage throw and hang the caller.
    const transfer = [...new Set([result.prg.buffer, result.d64.buffer])];
    postMessage({ type: "done", id, ...result }, transfer);
  } catch (err) {
    postMessage({ type: "error", id, message: err?.message ?? String(err) });
  }
};

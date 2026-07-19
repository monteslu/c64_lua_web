// build-client.js — main-thread client for the build Worker.
//
// One long-lived Worker (warm tools: cc65/ca65/ld65 compiled once, share tree
// mounted once), driven request/response by id. Both the React app and the test
// hook use this, so there is one place that owns the worker protocol.

let worker = null;
let nextId = 1;
const pending = new Map();   // id -> { resolve, reject, onProgress }

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./build-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { type, id } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (type === "progress") { p.onProgress?.(e.data.msg); return; }
    pending.delete(id);
    if (type === "done" || type === "warm-done") p.resolve(e.data);
    else if (type === "error") p.reject(new Error(e.data.message || "build failed"));
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || "worker crashed"));
    pending.clear();
  };
  return worker;
}

/**
 * Create the build worker and start warming it (compile the WASM tools + fetch
 * the share/SDK trees) NOW — call once on app mount. Idempotent.
 */
let warmed = null;
export function prewarm() {
  if (warmed) return warmed;
  const w = ensureWorker();
  const id = nextId++;
  warmed = new Promise((resolve) => {
    pending.set(id, { resolve, reject: resolve });   // warmup is best-effort
    w.postMessage({ type: "warm", id });
  });
  return warmed;
}

/**
 * @typedef {object} BuildOpts
 * @property {boolean} [num8]   build in the 8.8 number model
 * @property {boolean} [dev]    the SDK's dev build (extra checks)
 * @property {string} [name]    project name; becomes the .d64 disk label
 * @property {(msg:string)=>void} [onProgress]
 */

/**
 * Build a Lua game to a .prg AND its autostart .d64 in the worker.
 * @param {string} source
 * @param {BuildOpts} [opts]
 * @returns {Promise<{ ok:boolean, prg:Uint8Array, d64:Uint8Array, ms:number }>}
 */
export function build(source, opts = {}) {
  const w = ensureWorker();
  const id = nextId++;
  const { onProgress, ...rest } = opts;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ type: "build", id, source, opts: rest });
  });
}

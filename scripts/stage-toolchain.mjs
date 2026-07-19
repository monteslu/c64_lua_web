// Stage everything the browser needs into public/ so Vite serves it:
//   public/cc65     the cc65 WASM tools + the share subtree they read
//   public/sdk      c64lua's C/asm runtime (the units build() compiles+links)
//   public/core     the VICE x64 libretro core (glue + wasm)
//   public/examples the forkable example gallery
//   public/docs     the c64lua cheatsheet
//
// Run after npm install (postinstall). public/* here is gitignored — it is all
// derived from installed packages, so regenerate anytime.
//
// A browser cannot list a directory at runtime, so every staged tree also gets
// a manifest.json naming its files; the tool runner and the SDK loader fetch
// that first.
import { cp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

// Resolve c64lua (and the cc65 toolchain it bundles) through node's own
// resolution, so this works whether c64lua is the published npm package or a
// local file: link — the IDE needs no sibling SDK checkout.
const C64LUA = path.dirname(require.resolve("c64lua/package.json"));
// romdev-toolchain-cc65 doesn't export ./package.json and npm may hoist it, so
// resolve its main entry (from c64lua's scope) and walk up to the package root.
const cc65Main = require.resolve("romdev-toolchain-cc65", { paths: [C64LUA, HERE] });
const PKG = cc65Main.slice(0, cc65Main.lastIndexOf("romdev-toolchain-cc65") + "romdev-toolchain-cc65".length);
if (!existsSync(path.join(PKG, "wasm"))) {
  console.error(`romdev-toolchain-cc65 wasm not found under ${PKG}\nRun 'npm install' first.`);
  process.exit(1);
}

/** Walk a directory tree, returning every file path relative to its root. */
async function walkFiles(root) {
  const out = [];
  const walk = async (dir, rel) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const rp = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rp);
      else out.push(rp);
    }
  };
  await walk(root, "");
  return out;
}

// ---- cc65 toolchain -> public/cc65 -----------------------------------------
const OUT = path.join(HERE, "public", "cc65");
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "wasm"), { recursive: true });
await mkdir(path.join(OUT, "share"), { recursive: true });

for (const f of ["cc65.js", "ca65.js", "ld65.js", "cc65.wasm", "ca65.wasm", "ld65.wasm"]) {
  await cp(path.join(PKG, "wasm", f), path.join(OUT, "wasm", f));
}
// The subdirs the three tools actually read: cc65 -> include, ca65 -> asminc,
// ld65 -> lib + cfg. (The big target/ tree is never touched by this build.)
const SUBS = ["asminc", "include", "lib", "cfg"];
for (const sub of SUBS) {
  await cp(path.join(PKG, "share", "cc65", sub), path.join(OUT, "share", sub), { recursive: true });
}
const manifest = {};
for (const sub of SUBS) manifest[sub] = await walkFiles(path.join(OUT, "share", sub));
await writeFile(path.join(OUT, "share", "manifest.json"), JSON.stringify(manifest));
console.log("staged cc65 toolchain -> public/cc65 (" + SUBS.map((s) => `${s}=${manifest[s].length}`).join(" ") + ")");

// ---- c64lua SDK runtime -> public/sdk --------------------------------------
// The whole sdk/ dir (.c/.s/.h/.cfg) so #includes resolve without cherry-picking.
const SDK = path.join(C64LUA, "sdk");
const SDK_OUT = path.join(HERE, "public", "sdk");
await rm(SDK_OUT, { recursive: true, force: true });
await cp(SDK, SDK_OUT, { recursive: true });
const sdkFiles = await walkFiles(SDK_OUT);
await writeFile(path.join(SDK_OUT, "manifest.json"), JSON.stringify({ files: sdkFiles }));
console.log(`staged SDK runtime -> public/sdk (${sdkFiles.length} files)`);

// ---- VICE core -> public/core ----------------------------------------------
// The libretro core's glue .js + .wasm so the emulator pane can run the built
// .prg. The glue is node-targeted; the shared WebHost fetches its text and
// flips the env flags, so we ship it verbatim.
const CORE_PKG = path.dirname(require.resolve("romdev-core-vice", { paths: [C64LUA, HERE] }));
const CORE_OUT = path.join(HERE, "public", "core");
await rm(CORE_OUT, { recursive: true, force: true });
await mkdir(CORE_OUT, { recursive: true });
const coreWasmDir = existsSync(path.join(CORE_PKG, "wasm")) ? path.join(CORE_PKG, "wasm") : CORE_PKG;
const coreFiles = (await readdir(coreWasmDir)).filter((f) => /vice.*\.(js|wasm)$/.test(f));
if (!coreFiles.length) throw new Error(`no VICE core files found under ${coreWasmDir}`);
for (const f of coreFiles) await cp(path.join(coreWasmDir, f), path.join(CORE_OUT, f));
console.log("staged VICE core -> public/core (" + coreFiles.join(" + ") + ")");

// ---- examples -> public/examples -------------------------------------------
// The forkable seed set, straight from the c64lua package so the gallery always
// matches the installed compiler. Each is a lone main.lua.
const EX_OUT = path.join(HERE, "public", "examples");
const SDK_EX = path.join(C64LUA, "examples");
const EX_LIST = [
  { name: "hello", blurb: "A smiley and a greeting. The starting point." },
  { name: "plasma", blurb: "A rolling plasma field. Fixed-point math, full screen." },
  { name: "pad-square", blurb: "Move a square with the joystick. Input basics." },
  { name: "mathcheck", blurb: "The fixed-point math suite, on screen." },
];
await rm(EX_OUT, { recursive: true, force: true });
await mkdir(EX_OUT, { recursive: true });
const examples = [];
for (const ex of EX_LIST) {
  const src = path.join(SDK_EX, ex.name, "main.lua");
  // a listed example whose source is missing is a BUILD ERROR, not a silent
  // skip — a silent skip is how examples vanish from a deploy unnoticed.
  if (!existsSync(src)) throw new Error(`example "${ex.name}" listed in EX_LIST but ${src} is missing`);
  await mkdir(path.join(EX_OUT, ex.name), { recursive: true });
  await cp(src, path.join(EX_OUT, ex.name, "main.lua"));
  examples.push({ name: ex.name, blurb: ex.blurb, files: ["main.lua"] });
}
await writeFile(path.join(EX_OUT, "manifest.json"), JSON.stringify({ examples }));
console.log("staged examples -> public/examples (" + examples.map((e) => e.name).join(", ") + ")");

// ---- docs -> public/docs ----------------------------------------------------
const DOCS_OUT = path.join(HERE, "public", "docs");
const DOCS_SRC = path.join(C64LUA, "docs");
await rm(DOCS_OUT, { recursive: true, force: true });
await mkdir(DOCS_OUT, { recursive: true });
const staged = [];
if (existsSync(DOCS_SRC)) {
  for (const f of await readdir(DOCS_SRC)) {
    if (!f.endsWith(".md")) continue;
    await cp(path.join(DOCS_SRC, f), path.join(DOCS_OUT, f));
    staged.push(f);
  }
}
if (staged.length) console.log(`staged docs -> public/docs (${staged.length} md files)`);

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const GL_STUB = fileURLToPath(new URL("./src/emu/gl-stub.js", import.meta.url));

// c64lua's package.json `exports` covers the compiler entries this IDE needs
// (./compiler/index.js, ./compiler/builtins.js, ./compiler/c64_palette.js and
// ./build) — but NOT bin/d64.mjs, its pure-JS 1541 disk writer. The .d64 is the
// headline artifact of a C64 build and that writer is the one the CLI uses, so
// the browser runs the SAME code rather than a second implementation that could
// drift. Resolve the one deep path straight to disk. (Upstream fix: add
// "./bin/d64.mjs" to the exports map; then this alias becomes a no-op.)
const require = createRequire(import.meta.url);
const C64LUA = path.dirname(require.resolve("c64lua/package.json"));

export default defineConfig({
  plugins: [react()],
  // The staged toolchain under public/cc65 + the SDK runtime under public/sdk
  // are served as-is; nothing to configure for them.
  //
  // node: builtins stay external in BOTH bundles: c64lua's build driver has
  // lazy node fallbacks that never execute in the browser — every seam is
  // env-injected — but rollup still follows the literal import paths.
  worker: { format: "es", rollupOptions: { external: [/^node:/] } },
  resolve: {
    // luacretro-web ships raw JSX (no build step in the lib). It is symlinked in
    // via `file:`, so React must resolve to ONE copy across the symlink boundary
    // or hooks blow up with the classic invalid-hook-call.
    dedupe: ["react", "react-dom"],
    alias: [
      // romdev-core-host declares native-gles/webgl-node as OPTIONAL deps and
      // only reaches them through a lazy `await import()` in glOptionalDep.js,
      // on the HW-render path for the 3D cores (N64/PS1/Dreamcast). VICE is a
      // software core, so that path never runs in this app — but esbuild and
      // rollup still FOLLOW the literal specifier, and native-gles is a .node
      // binary neither can load. Stub the specifiers; nothing imports them.
      { find: /^native-gles$/, replacement: GL_STUB },
      { find: /^webgl-node$/, replacement: GL_STUB },
      // see the C64LUA note above: the .d64 writer, by real path.
      { find: /^c64lua\/bin\/(.*)$/, replacement: path.join(C64LUA, "bin/$1") },
    ],
  },
  optimizeDeps: {
    // the lib is raw JSX + symlinked: esbuild's dep scanner would choke on it
    exclude: ["luacretro-web"],
    include: [
      // luacretro-web itself is excluded, but its deps are plain ESM in
      // node_modules and Vite discovers them LATE — as imports of an excluded
      // dep. Listing them here prebundles them at server start; without it the
      // first import 504s as an "Outdated Optimize Dep" and the page never boots.
      "romdev-core-host",
      "romdev-core-host/framebuffer.js",
      "@monaco-editor/react",
      // Every c64lua module the app AND the build worker use — including the
      // ones reached LAZILY from the worker (c64lua/build and its imports).
      // Without them prebundled at server start, Vite discovers them mid-build,
      // reloads the page, and destroys the execution context a Playwright test
      // is driving — the exact failure this list exists to prevent.
      "c64lua/compiler/index.js",
      "c64lua/compiler/builtins.js",
      "c64lua/compiler/c64_palette.js",
      "c64lua/compiler/peephole.js",   // imported by build.js, so the worker reaches it
      "c64lua/build",
      // the .d64 writer, listed by real path because the alias above rewrites
      // the specifier before optimizeDeps sees it
      path.join(C64LUA, "bin/d64.mjs"),
    ],
  },
  // same node-builtin externalization for the production bundle
  build: { rollupOptions: { external: [/^node:/] } },
});

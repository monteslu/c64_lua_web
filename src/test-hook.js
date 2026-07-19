// test-hook.js — expose the build + emulator path to Playwright
// (window.__c64luaWeb). The App fills in the UI-facing pieces once mounted; the
// raw build path and a headless boot-smoke helper are available immediately,
// since the byte-identity gate needs no UI.
import { build as _build, prewarm } from "./build/build-client.js";
import { createC64Host } from "./emu/c64-host.js";

function bytesToB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * build() wrapper returning both artifacts as base64 (structured-clone friendly
 * for page.evaluate).
 */
async function build(source, opts = {}) {
  try {
    const r = await _build(source, opts);
    return {
      ok: !!r.ok, ms: r.ms,
      prgBase64: r.prg ? bytesToB64(r.prg) : null,
      d64Base64: r.d64 ? bytesToB64(r.d64) : null,
    };
  } catch (e) {
    return { ok: false, log: e?.message ?? String(e), prgBase64: null, d64Base64: null };
  }
}

/**
 * Boot a disk image headlessly for N frames on VICE; return a coarse pixel sum
 * so a test can assert "not blank" without any vision.
 */
async function bootSmoke(mediaB64, frames = 600) {
  const host = createC64Host();
  await host.load(b64ToBytes(mediaB64));
  const canvas = document.createElement("canvas");
  canvas.width = host.fbWidth;
  canvas.height = host.fbHeight;
  host.canvas = canvas;
  host.ctx = canvas.getContext("2d", { alpha: false });
  host.imageData = host.ctx.createImageData(host.fbWidth, host.fbHeight);
  host.stepFrames(frames);
  const px = host.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  const seen = new Set();
  for (let i = 0; i < px.length; i += 4) {
    sum += px[i] + px[i + 1] + px[i + 2];
    seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
  }
  host.dispose();
  return { pixelSum: sum, colors: seen.size, width: canvas.width, height: canvas.height };
}

window.__c64luaWeb = {
  build, prewarm, bootSmoke,
  setSource: null, getSource: null, getHost: null, buildCurrent: null,
};

// buffer-shim.js — the sliver of node's Buffer that c64lua's .d64 writer uses.
//
// The .d64 wrap is the headline artifact of a C64 build, and c64lua already
// ships a correct, pure-JS 1541 image writer (bin/d64.mjs): valid BAM, a real
// directory entry, the file's sector chain. Reimplementing that for the browser
// would mean two writers to keep in agreement, and the one place they disagreed
// would be a disk image that a real machine refuses to load.
//
// So the browser runs the SAME writer, unmodified. It touches exactly two
// Buffer APIs — `Buffer.alloc(n, fill)` and the `.set()` it inherits from
// Uint8Array — and Uint8Array covers both. This shim provides that much and
// nothing else: anything the writer might grow into will fail loudly here
// rather than silently producing a subtly wrong image.
//
// Installed on globalThis by the build worker BEFORE d64.mjs is imported.

/** A Buffer stand-in backed by Uint8Array. */
export const BufferShim = {
  /**
   * @param {number} size
   * @param {number} [fill]
   * @returns {Uint8Array}
   */
  alloc(size, fill = 0) {
    const u8 = new Uint8Array(size);
    if (fill) u8.fill(fill);
    return u8;
  },
  from(src) {
    return src instanceof Uint8Array ? new Uint8Array(src) : Uint8Array.from(src);
  },
  isBuffer(v) {
    return v instanceof Uint8Array;
  },
};

/** Install the shim if the environment has no real Buffer. Idempotent. */
export function installBufferShim() {
  if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = BufferShim;
}

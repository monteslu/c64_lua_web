// c64-host.js — the C64 facts, over the shared WebHost.
//
// The presenter itself (canvas blit, Web Audio sink, rAF loop, input plumbing)
// is luacretro-web/emu. Everything here is what makes it a C64: which core to
// load, the framebuffer geometry, and the joystick map.

import { WebHost, PAD } from "luacretro-web/emu";

const CORE_GLUE = "/core/vice_x64_libretro.js";
const CORE_WASM = "/core/vice_x64_libretro.wasm";

/** The VICE framebuffer: border included, which is what the core outputs. */
export const C64_WIDTH = 384;
export const C64_HEIGHT = 272;

/**
 * SQUARE pixels, deliberately.
 *
 * c64lua's run bridge passes `aspect: "fb"` to the SDL host — present the
 * framebuffer at its own shape rather than stretching it to a 4:3 TV. The IDE
 * matches that, so what an artist sees here is what `c64lua run` shows: the
 * multicolor mode's 2:1 pixels stay visibly 2:1 (the sprite editor's fatPixel
 * flag draws them the same way) instead of being hidden by a display stretch.
 */
export const C64_ASPECT = "fb";

/**
 * Keyboard -> RetroPad, taken VERBATIM from c64lua's run bridge
 * (bin/c64lua-run.mjs) so the IDE and `c64lua run` play identically:
 *   arrows = joystick directions, Z = fire (bit 0), Space = second action (bit 8).
 */
export const KEY_MAP = {
  ArrowUp: PAD.UP, ArrowDown: PAD.DOWN, ArrowLeft: PAD.LEFT, ArrowRight: PAD.RIGHT,
  KeyZ: PAD.B,      // Z = fire        (RetroPad bit 0)
  Space: PAD.A,     // Space = action 2 (RetroPad bit 8)
};

/**
 * A C64 machine bound to a canvas.
 * @param {object} [opts]
 * @returns {WebHost}
 */
export function createC64Host(opts = {}) {
  return new WebHost({
    coreGlueUrl: CORE_GLUE,
    coreWasmUrl: CORE_WASM,
    platform: "c64",
    // VICE reads the extension to pick its loader. A .d64 autostarts
    // (LOAD"*",8,1 : RUN), which is how a real machine loads the disk — and it
    // is the artifact the IDE hands users, so it is what the IDE runs.
    mediaPath: "game.d64",
    keyMap: KEY_MAP,
    width: C64_WIDTH,
    height: C64_HEIGHT,
    fpsFallback: 50,   // PAL
    ...opts,
  });
}

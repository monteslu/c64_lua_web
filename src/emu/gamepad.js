// gamepad.js — the C64 joystick as this IDE names it.
//
// Polling, per-controller persistence, and the remap walk are shared
// (luacretro-web/input). What is ours is the INPUT TABLE: a 1980s digital
// joystick — four directions and a fire button — plus the second action key
// c64lua's run bridge exposes.

import { createGamepad } from "luacretro-web/input";
import { PAD } from "luacretro-web/emu";

/**
 * The C64 joystick. Fire is the only button a real Commodore stick had; the
 * "action 2" input mirrors c64lua's run bridge, which maps Space to a second
 * button so games can offer one without a second controller.
 */
export const C64_INPUTS = [
  { key: "UP", label: "Up", pad: PAD.UP },
  { key: "DOWN", label: "Down", pad: PAD.DOWN },
  { key: "LEFT", label: "Left", pad: PAD.LEFT },
  { key: "RIGHT", label: "Right", pad: PAD.RIGHT },
  { key: "FIRE", label: "Fire", pad: PAD.B },
  { key: "ACTION2", label: "Action 2", pad: PAD.A },
];

/**
 * Standard-layout default. Fire lands on the south face — the button every
 * thumb reaches first — matching the SDK's keyboard choice of Z for fire.
 */
export const STANDARD_BINDS = {
  UP: { kind: "button", index: 12 },
  DOWN: { kind: "button", index: 13 },
  LEFT: { kind: "button", index: 14 },
  RIGHT: { kind: "button", index: 15 },
  FIRE: { kind: "button", index: 0 },      // south face -> fire
  ACTION2: { kind: "button", index: 1 },   // east face  -> action 2
};

const gp = createGamepad({
  inputs: C64_INPUTS,
  standardBinds: STANDARD_BINDS,
  storagePrefix: "c64lua-gamepad-map:",
});

export const { pollGamepads, firstConnected, firstUnmapped, bindsFor, saveMapping } = gp;

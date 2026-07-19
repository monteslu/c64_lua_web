// useResizableColumns — c64lua's three-column layout.
//
// Shared implementation (luacretro-web/ide); the emulator clamp is ours: the
// VICE framebuffer is 384 wide and presented with SQUARE pixels (aspect "fb"),
// so it wants a little more width than the 320-wide consoles.
import { createUseResizableColumns, SIDEBAR_PX } from "luacretro-web/ide";

export { SIDEBAR_PX };
export const EMU_PX = { min: 384, max: 768 };

export const useResizableColumns = createUseResizableColumns({
  storageKey: "c64lua-ide-cols",
  emuPx: EMU_PX,
  defaultEmuPx: 480,
});

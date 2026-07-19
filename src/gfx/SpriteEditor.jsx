// SpriteEditor — the shared PixelEditor, wearing C64 facts.
//
// The editor core (tools, zoom, selection, undo, the per-cell color budget) is
// luacretro-web/gfx. What is ours: the C64 SurfaceDescriptor — 16 fixed colors,
// 4x8 multicolor cells, 2:1 fat pixels — and the shared-backdrop rule, which is
// what keeps attribute clash honest as you paint.
import { PixelEditor } from "luacretro-web/gfx";
import { C64_SURFACE, C64_PALETTE_ABGR, C64_COLOR_NAMES, blankSheet } from "./c64-surface.js";

/** #rrggbb for a C64 index (the editor stores pixels as 0xAABBGGRR). */
function hexOf(i) {
  const c = C64_PALETTE_ABGR[i] ?? 0xff000000;
  const r = c & 0xff, g = (c >> 8) & 0xff, b = (c >> 16) & 0xff;
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

export function SpriteEditor({ sheet, onChange, backdrop = 0, onBackdrop }) {
  // The backdrop is ONE screen-wide color, not a per-cell one, so it never
  // spends a cell's 3-color budget. Handing it to the editor as a shared color
  // is what makes the budget check match the hardware.
  const sharedColors = [C64_PALETTE_ABGR[backdrop]];

  const picker = onBackdrop ? (
    <label className="backdrop-pick" title="the screen-wide background color — free in every cell">
      backdrop
      <select value={backdrop} onChange={(e) => onBackdrop(Number(e.target.value))}>
        {C64_COLOR_NAMES.map((n, i) => (
          <option key={i} value={i}>{i} · {n}</option>
        ))}
      </select>
      <span className="backdrop-chip" style={{ background: hexOf(backdrop) }} />
    </label>
  ) : null;

  return (
    <PixelEditor
      sheet={sheet}
      onChange={onChange}
      surface={C64_SURFACE}
      sharedColors={sharedColors}
      onNew={() => onChange(blankSheet())}
      extraTools={picker}
    />
  );
}

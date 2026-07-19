// PalettePane — the 16 fixed VIC-II colors.
//
// A c64lua color IS an index 0-15 into this table, so the pane's job is to make
// the index visible: click a swatch to drop that number into the code.
import { C64_PALETTE_RGB, C64_COLOR_NAMES } from "../gfx/c64-surface.js";

const css = ([r, g, b]) => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;

export function PalettePane({ onInsert }) {
  return (
    <div className="pane-scroll palette-pane">
      <p className="pane-note">
        The C64 has 16 fixed hardware colors. A color literal is its index 0–15.
        In multicolor mode each 4×8 cell may use the shared backdrop plus 3 of
        them. Click a swatch to insert its index.
      </p>
      <div className="c64-palette-grid">
        {C64_PALETTE_RGB.map((rgb, i) => (
          <button
            key={i}
            className="c64-swatch"
            style={{ background: css(rgb) }}
            title={`${i} · ${C64_COLOR_NAMES[i]} ${css(rgb)}`}
            onClick={() => onInsert?.(String(i))}
          >
            <span className="c64-swatch-id">{i}</span>
            <span className="c64-swatch-name">{C64_COLOR_NAMES[i]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

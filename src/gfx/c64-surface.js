// c64-surface.js — the C64 drawing surface, as the shared PixelEditor sees it.
//
// The editor core (paint tools, zoom, selection, guides, the per-cell color
// budget) is luacretro-web/gfx. This file is only the C64 hardware facts.

import { C64_PALETTE } from "c64lua/compiler/c64_palette.js";

/** 0xAABBGGRR (the editor's pixel format) from an [r,g,b] triple. */
const abgr = ([r, g, b]) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;

/**
 * The 16 fixed VIC-II colors as editor pixels. Index IS the c64lua color value,
 * so what an artist picks is exactly what the game writes.
 */
export const C64_PALETTE_ABGR = C64_PALETTE.map(abgr);

/** The canonical [r,g,b] table, for a palette pane that wants to label it. */
export const C64_PALETTE_RGB = C64_PALETTE;

/** The VIC-II color names, in hardware index order. */
export const C64_COLOR_NAMES = [
  "black", "white", "red", "cyan",
  "purple", "green", "blue", "yellow",
  "orange", "brown", "light red", "dark grey",
  "medium grey", "light green", "light blue", "light grey",
];

/**
 * The C64 multicolor bitmap surface.
 *
 * Multicolor mode halves the horizontal resolution: 160 pixels across the same
 * screen width as 320, so every pixel is TWICE AS WIDE as it is tall. That is
 * what `fatPixel: 2` tells the editor — draw each pixel 2:1 so the artist
 * composes at the shape the hardware will actually display. Drawing C64
 * multicolor art on a square-pixel grid is how you end up with sprites that
 * look correct in the editor and squashed on screen.
 *
 * The color budget is the classic attribute clash: within each 4x8 cell you get
 * one screen-wide shared backdrop plus 3 freely chosen colors. The backdrop is
 * shared across the WHOLE screen (not per cell), so it never costs a cell any
 * of its three — that is what the editor's `sharedColors` prop is for.
 */
export const C64_SURFACE = {
  cellW: 4,
  cellH: 8,
  // 3 free colors per cell (the shared backdrop is accounted separately)
  maxColors: 3,
  sheetW: 160,
  sheetH: 128,
  palette: C64_PALETTE_ABGR,
  fatPixel: 2,          // multicolor pixels are 2:1
  cellLabel: "4×8 multicolor cells",
  grids: [
    // a faint 8x8 hint (two cells wide) under the real 4x8 cell grid
    { step: 8, stepY: 8, color: "rgba(120,200,255,0.16)" },
    { step: 4, stepY: 8, color: "rgba(255,255,255,0.16)" },
  ],
  colorRules: {
    maxPerCell: 3,
    transparent: true,
    shared: 1,          // the screen-wide backdrop
    note: "Each 4×8 cell: the shared backdrop + 3 free colors (attribute clash).",
  },
};

/** A blank sheet of the default size. */
export function blankSheet(w = C64_SURFACE.sheetW, h = C64_SURFACE.sheetH) {
  return { width: w, height: h, px: new Uint32Array(w * h) };
}

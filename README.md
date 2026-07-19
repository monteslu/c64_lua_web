# c64_lua_web

A browser IDE for [c64lua](https://www.npmjs.com/package/c64lua): write
Commodore 64 games in PICO-8-flavored Lua, build a real `.prg` and an autostart
`.d64` disk image, and play it — all in the browser, with no toolchain to
install.

The build is not a simulation. The page runs the **real cc65 toolchain**
(cc65 → ca65 → ld65) compiled to WebAssembly, driving c64lua's own build
pipeline, and wraps the result with c64lua's own pure-JS 1541 disk writer. Both
artifacts are **byte-identical** to what `c64lua build --d64` produces on the
command line, and the test suite asserts exactly that on every run.

## Running it

```sh
npm install     # also stages the toolchain, core, examples and docs into public/
npm run dev
```

## What's in it

- **Code** — Monaco with live c64lua diagnostics. An error gates Play, so you
  can never run a program that would not build. Ctrl+Enter builds and runs.
- **Pixels** — a multicolor bitmap editor over the 16 fixed VIC-II colors, with
  **2:1 fat pixels** (multicolor mode's real pixel shape, not a square-pixel
  lie) and the 4×8 attribute-clash budget enforced as you paint: the shared
  backdrop plus 3 free colors per cell.
- **Palette** — all 16 hardware colors by name; click one to drop its index
  into code.
- **Cheatsheet** — c64lua's own docs, staged from the installed package.
- **Emulator** — VICE, presented at 384×272 with **square pixels** (`aspect:
  "fb"`), matching what `c64lua run` shows. Arrows = joystick, Z = fire,
  Space = action 2. Gamepads work with no setup.

The emulator boots the **.d64**, not the raw .prg — the same artifact the
download button hands you, loaded the way a real machine loads it
(`LOAD"*",8,1 : RUN`). The disk boot takes a few seconds, exactly as it would
on hardware.

## Tests

```sh
npm test
```

- `test/browser-build.mjs` — builds two examples in a real browser with real
  WASM cc65 and asserts both the `.prg` and the `.d64` are byte-identical to
  the CLI build, then boots the disk far enough to prove the *game* renders
  rather than the KERNAL boot screen.
- `test/ui-drive.mjs` — drives the actual UI in Chromium: gallery → clone →
  Play → renders, error gating, tab rendering, `.d64` download.

## How it is built

Almost all of the IDE is the shared `luacretro-web` toolkit — the emulator
presenter, the Monaco language service, the gamepad layer, the IDE shell, the
pixel editor, the theme, and the in-browser WASM tool runner. What lives in
this repo is only what is C64 about it: the VICE host and joystick map, the
surface descriptor (fat pixels, attribute clash), the build worker's cc65 and
.d64 wiring, and the blue accent over the shared theme.

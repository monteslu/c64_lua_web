// EmulatorPane — the VICE canvas + controls. Owns the host lifecycle: a new
// disk image disposes the old host and boots a fresh one. Keyboard maps to the
// joystick while the screen has focus; standard-layout gamepads work with no
// setup, and a mapper handles anything else.
//
// The canvas is VICE's own 384x272 output, border included, presented with
// SQUARE pixels — c64lua's run bridge passes aspect:"fb" and the IDE matches
// it, so what you see here is what `c64lua run` shows.
import { useEffect, useRef, useState, useCallback } from "react";
import { GamepadMapper } from "luacretro-web/input";
import { createC64Host, KEY_MAP, C64_WIDTH, C64_HEIGHT } from "./c64-host.js";
import { pollGamepads, firstConnected, firstUnmapped, bindsFor, saveMapping, C64_INPUTS } from "./gamepad.js";

export default function EmulatorPane({ media, onHost, building, progress }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const [status, setStatus] = useState("no disk");
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pad, setPad] = useState(null);
  const [mapping, setMapping] = useState(null);

  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    (async () => {
      setStatus("booting…");
      hostRef.current?.dispose();
      hostRef.current = null;
      onHost?.(null);
      try {
        const host = await createC64Host().load(media);
        if (cancelled) { host.dispose(); return; }
        host.pollPads = (out) => { pollGamepads(out); };
        host.start(canvasRef.current);
        hostRef.current = host;
        onHost?.(host);
        setPaused(false);
        // the .d64 autostarts (LOAD"*",8,1 : RUN), the same as a real drive —
        // so there are a few seconds of KERNAL boot before the game appears
        setStatus(`running — ${media.length.toLocaleString()} byte disk`);
      } catch (e) {
        setStatus(`emulator error: ${e.message}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  useEffect(() => () => { hostRef.current?.dispose(); onHost?.(null); }, [onHost]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const gp = firstConnected();
      setPad(gp ? { connected: true, needsMap: !bindsFor(gp) } : null);
      raf = requestAnimationFrame(() => setTimeout(tick, 500));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const onKey = useCallback((down) => (e) => {
    const id = KEY_MAP[e.code];
    if (id === undefined || !hostRef.current) return;
    e.preventDefault();
    hostRef.current.setPad(id, down);
  }, []);

  const togglePause = () => {
    const h = hostRef.current;
    if (!h) return;
    if (h.isPaused()) { h.resume(); setPaused(false); }
    else { h.pause(); setPaused(true); }
  };

  const goFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    hostRef.current?.unlockAudio();
    canvasRef.current?.focus();
  };

  const select = () => { hostRef.current?.unlockAudio(); canvasRef.current?.focus(); };
  const openMapper = () => { const gp = firstUnmapped() || firstConnected(); if (gp) setMapping(gp); };

  return (
    <div className="emu-pane">
      <div className="emu-screen-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="emu-screen"
          width={C64_WIDTH}
          height={C64_HEIGHT}
          tabIndex={0}
          onKeyDown={onKey(true)}
          onKeyUp={onKey(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={select}
        />

        {building && (
          <div className="emu-overlay building">
            <span className="emu-ov-label">{progress?.label ?? "building…"}</span>
            <div className="emu-bar"><div className="emu-fill" style={{ width: `${Math.round((progress?.frac ?? 0) * 100)}%` }} /></div>
          </div>
        )}
        {!building && hostRef.current && !focused && (
          <div className="emu-overlay hint" onClick={select}><span>click to play</span></div>
        )}
        {!building && !hostRef.current && !media && (
          <div className="emu-overlay idle"><span>▶ Play to build &amp; run</span></div>
        )}

        <button className="emu-fs" onClick={goFullscreen} title="fullscreen (grabs the controls)" aria-label="fullscreen">⛶</button>
      </div>

      <div className="emu-bar-row">
        <span className="emu-status">{status}</span>
        {pad?.connected && (
          <button className={"emu-pad " + (pad.needsMap ? "unmapped" : "")}
            onClick={openMapper}
            title={pad.needsMap ? "controller needs mapping — click to map" : "controller connected — click to remap"}>
            joystick{pad.needsMap ? " · map" : ""}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={togglePause} disabled={!hostRef.current}>{paused ? "resume" : "pause"}</button>
        <button onClick={() => hostRef.current?.reset()} disabled={!hostRef.current}>reset</button>
      </div>
      <div className="emu-help">
        arrows = joystick · Z = fire · Space = action 2 · gamepad supported
      </div>

      {mapping && (
        <GamepadMapper
          gamepad={mapping}
          inputs={C64_INPUTS}
          saveMapping={saveMapping}
          onDone={() => setMapping(null)}
          onClose={() => setMapping(null)}
        />
      )}
    </div>
  );
}

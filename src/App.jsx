// App — the c64lua web IDE shell. 3-column resizable layout
// (projects | editor tabs | emulator).
//
// The compiler is the language service: it runs per keystroke, so diagnostics
// are live and an error GATES Play (you cannot run a program that would not
// build). Play compiles Lua -> .prg in the build worker with the real cc65
// toolchain, wraps it in an autostart .d64 with c64lua's own 1541 writer, and
// boots that disk on VICE — the same path a real machine takes.
import { useState, useMemo, useRef, useCallback, useEffect, Suspense, lazy } from "react";
import { compile } from "c64lua/compiler/index.js";
import { Sidebar, downloadBytes, pickFile, zipWrite, createZipRead } from "luacretro-web/ide";
import EmulatorPane from "./emu/EmulatorPane.jsx";
import Editor from "./Editor.jsx";
import { build, prewarm } from "./build/build-client.js";
import { listProjects, getProject, createProject, saveProject, deleteProject } from "./projects/store.js";
import { loadExamples, loadExampleFiles } from "./examples.js";
import { useResizableColumns } from "./util/useResizableColumns.js";

const SpriteEditor = lazy(() => import("./gfx/SpriteEditor.jsx").then((m) => ({ default: m.SpriteEditor })));
const PalettePane = lazy(() => import("./hw/PalettePane.jsx").then((m) => ({ default: m.PalettePane })));
const CheatsheetPane = lazy(() => import("./CheatsheetPane.jsx"));

const zipRead = createZipRead();
const dec = new TextDecoder();
const asBytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
const asText = (v) => (typeof v === "string" ? v : dec.decode(v));

const BLANK_SOURCE = `-- a new C64 program
function _init()
end

function _update()
end

function _draw()
  cls(6)
  print("hello c64", 10, 10, 1)
end
`;

const TABS = [
  { id: "code", label: "Code" },
  { id: "sprite", label: "Pixels" },
  { id: "palette", label: "Palette" },
  { id: "cheat", label: "Cheatsheet" },
];

export default function App() {
  const [projects, setProjects] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [projectName, setProjectName] = useState("");
  const [source, setSource] = useState("");
  const [sheet, setSheet] = useState(null);
  const [backdrop, setBackdrop] = useState(0);
  const [view, setView] = useState("code");

  // the two build artifacts: the .prg (what links) and the .d64 (what ships
  // AND what the emulator boots, so the IDE runs exactly what it hands you)
  const [prg, setPrg] = useState(null);
  const [d64, setD64] = useState(null);
  const [, setHost] = useState(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(null);
  const [warm, setWarm] = useState(false);
  const [buildMsg, setBuildMsg] = useState("");
  const [buildErr, setBuildErr] = useState("");
  const [gallery, setGallery] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const buildSeq = useRef(0);
  const saveTimers = useRef({});
  const editorApi = useRef(null);

  const insertSnippet = useCallback((text) => {
    setView("code");
    setTimeout(() => editorApi.current?.insert(text), 0);
  }, []);

  const { sidebarPx, emuPx, startSidebarDrag, startEmuDrag } = useResizableColumns();

  // live compile: diagnostics + the Play gate. Cheap enough to run per keystroke.
  const compileResult = useMemo(() => {
    try { return compile(source, "main.lua"); }
    catch (e) { return { ok: false, diagnostics: [{ line: 1, col: 1, severity: "error", message: e.message }] }; }
  }, [source]);
  const errors = (compileResult.diagnostics || []).filter((d) => d.severity === "error");
  const warnings = (compileResult.diagnostics || []).filter((d) => d.severity === "warning");

  const refreshProjects = useCallback(async () => setProjects(await listProjects()), []);

  const openProject = useCallback(async (id) => {
    const rec = await getProject(id);
    if (!rec) return;
    setCurrentId(id);
    setProjectName(rec.name);
    setSource(asText(rec.files["main.lua"] ?? BLANK_SOURCE));
    setSheet(null);
    setPrg(null);
    setD64(null);
    setView("code");
  }, []);

  useEffect(() => {
    prewarm().then(() => setWarm(true));
    (async () => {
      const list = await listProjects();
      setProjects(list);
      if (list.length) openProject(list[0].id);
      else setShowNew(true);
    })();
  }, [openProject]);

  useEffect(() => { loadExamples().then(setGallery).catch(() => setGallery([])); }, []);

  const persist = useCallback((key, mutate, debounceMs = 500) => {
    if (!currentId) return;
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      mutate(rec.files);
      await saveProject(rec, Date.now());
      refreshProjects();
    }, debounceMs);
  }, [currentId, refreshProjects]);

  const onChange = useCallback((v) => {
    setSource(v);
    persist("main.lua", (files) => { files["main.lua"] = v; });
  }, [persist]);

  const newProject = useCallback(async () => {
    const rec = await createProject("untitled", { "main.lua": BLANK_SOURCE }, Date.now());
    setShowNew(false);
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  const forkExample = useCallback(async (ex) => {
    const files = await loadExampleFiles(ex);
    const rec = await createProject(ex.name, files, Date.now());
    setShowNew(false);
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  const removeProject = useCallback(async (id) => {
    await deleteProject(id);
    setConfirmDelete(null);
    const list = await listProjects();
    setProjects(list);
    if (id === currentId) {
      if (list.length) openProject(list[0].id);
      else { setCurrentId(null); setSource(""); setPrg(null); setD64(null); setShowNew(true); }
    }
  }, [currentId, openProject]);

  const rename = useCallback((name) => {
    setProjectName(name);
    if (!currentId) return;
    clearTimeout(saveTimers.current.name);
    saveTimers.current.name = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      rec.name = name || "untitled";
      await saveProject(rec, Date.now());
      refreshProjects();
    }, 400);
  }, [currentId, refreshProjects]);

  const play = useCallback(async () => {
    if (errors.length || !warm || !currentId || building) return;
    const seq = ++buildSeq.current;
    setBuilding(true); setBuildErr(""); setBuildMsg("building…");
    setProgress({ frac: 0, label: "starting…" });
    try {
      const r = await build(source, {
        // the project name becomes the .d64 disk label, matching how the CLI
        // derives it from the output filename
        name: projectName || "game",
        onProgress: (msg) => {
          if (seq !== buildSeq.current) return;
          setBuildMsg(String(msg));
          setProgress((p) => ({ frac: Math.min(0.9, (p?.frac ?? 0) + 0.08), label: String(msg) }));
        },
      });
      if (seq !== buildSeq.current) return;
      if (r.ok && r.prg) {
        setProgress({ frac: 1, label: "done" });
        setBuildMsg(`built ${r.prg.length.toLocaleString()} byte .prg in ${r.ms}ms`);
        setPrg(r.prg);
        setD64(r.d64);
      } else {
        setBuildErr("build failed");
        setBuildMsg("");
      }
    } catch (e) {
      if (seq !== buildSeq.current) return;
      setBuildErr(String(e?.message ?? e).split("\n").filter(Boolean).slice(-2).join(" · "));
      setBuildMsg("");
    } finally {
      if (seq === buildSeq.current) setBuilding(false);
    }
  }, [source, errors.length, warm, currentId, building, projectName]);

  const playRef = useRef(play);
  playRef.current = play;

  // the Playwright hook drives the REAL app through this
  useEffect(() => {
    if (!window.__c64luaWeb) return;
    window.__c64luaWeb.getSource = () => source;
    window.__c64luaWeb.setSource = (v) => onChange(v);
    window.__c64luaWeb.buildCurrent = () => playRef.current();
  }, [source, onChange]);

  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "r" || e.key === "R")) {
        e.preventDefault();
        playRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const base = () => (projectName || "game").replace(/\.(prg|d64)$/i, "");
  const downloadD64 = useCallback(() => {
    if (d64) downloadBytes(`${base()}.d64`, d64, "application/octet-stream");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d64, projectName]);
  const downloadPrg = useCallback(() => {
    if (prg) downloadBytes(`${base()}.prg`, prg, "application/octet-stream");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prg, projectName]);

  const exportBundle = useCallback(async () => {
    const rec = currentId ? await getProject(currentId) : { files: { "main.lua": source } };
    const files = {};
    for (const [p, v] of Object.entries(rec.files)) files[p] = asBytes(v);
    downloadBytes(`${projectName || "project"}.zip`, zipWrite(files), "application/zip");
  }, [currentId, source, projectName]);

  const importBundle = useCallback(async () => {
    const picked = await pickFile(".zip");
    if (!picked) return;
    try {
      const entries = zipRead(picked.bytes);
      const files = {};
      for (const [p, bytes] of Object.entries(entries)) {
        files[p] = /\.(lua|json)$/i.test(p) ? dec.decode(bytes) : bytes;
      }
      const name = picked.name.replace(/\.zip$/i, "");
      const rec = await createProject(name, files, Date.now());
      await refreshProjects();
      await openProject(rec.id);
    } catch (e) {
      setBuildErr(`import failed: ${e?.message ?? e}`);
    }
  }, [refreshProjects, openProject]);

  const playDisabled = building || !warm || !currentId || errors.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">c64lua <span className="brand-sub">web</span></span>
        <button className="play-btn" onClick={play} disabled={playDisabled}
          title={errors.length ? "fix errors first" : !warm ? "toolchain warming…" : "build & run (Ctrl+Enter)"}>
          ▶ {building ? "building…" : warm ? "Play" : "warming…"}
        </button>
        <span className="build-msg">{buildErr ? <span className="err">{buildErr}</span> : buildMsg}</span>
        <span style={{ flex: 1 }} />
        <input className="proj-name" value={projectName} onChange={(e) => rename(e.target.value)}
          placeholder="project" disabled={!currentId} title="project name (also the disk label)" />
        <button onClick={downloadD64} disabled={!d64} title="download the autostart .d64 disk image">⬇ .d64</button>
        <button onClick={downloadPrg} disabled={!prg} title="download the raw .prg">.prg</button>
        <button onClick={exportBundle} disabled={!currentId}>export .zip</button>
        <button onClick={importBundle}>import</button>
      </header>

      <div className="body">
        <Sidebar
          projects={projects} currentId={currentId}
          onOpen={openProject} onNew={() => setShowNew(true)}
          onDelete={(id) => setConfirmDelete(id)} width={sidebarPx}
        />
        <div className="col-drag" onPointerDown={startSidebarDrag} />

        <main className="editor-col">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={"tab " + (view === t.id ? "active" : "")}
                onClick={() => setView(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="pane">
            <Suspense fallback={<div className="loading">loading…</div>}>
              {/* Monaco stays mounted (it keeps undo history + view state) */}
              <div style={{ display: view === "code" ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
                <Editor value={source} onChange={onChange} onPlay={play} apiRef={editorApi} />
              </div>
              {view === "sprite" && (
                <SpriteEditor sheet={sheet} onChange={setSheet}
                  backdrop={backdrop} onBackdrop={setBackdrop} />
              )}
              {view === "palette" && <PalettePane onInsert={insertSnippet} />}
              {view === "cheat" && <CheatsheetPane />}
            </Suspense>
          </div>
          <div className="bottom">
            <div className="tabs sub">
              <button className="tab active">
                Problems {errors.length + warnings.length > 0 ? `(${errors.length + warnings.length})` : ""}
              </button>
            </div>
            <div className="bottom-body">
              <ul className="problems">
                {errors.length + warnings.length === 0 && <li className="ok">no problems</li>}
                {[...errors, ...warnings].map((d, i) => (
                  <li key={i} className={d.severity}>
                    <span className="loc">{d.line}:{d.col}</span> {d.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </main>

        <div className="col-drag" onPointerDown={startEmuDrag} />
        <section className="emu-col" style={{ flexBasis: `${emuPx}px`, width: `${emuPx}px` }}>
          {/* the emulator boots the DISK, the same artifact the download hands you */}
          <EmulatorPane media={d64} onHost={setHost} building={building} progress={progress} />
        </section>
      </div>

      {showNew && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && currentId) setShowNew(false); }}>
          <div className="gallery-box">
            <h2>Start a C64 program</h2>
            <p className="gallery-sub">Fork an example, or start from a blank program.</p>
            <div className="gallery-grid">
              {(gallery ?? []).map((ex) => (
                <button key={ex.name} className="gallery-card" onClick={() => forkExample(ex)}>
                  <span className="gallery-name">{ex.name}</span>
                  <span className="gallery-blurb">{ex.blurb}</span>
                </button>
              ))}
            </div>
            <div className="gallery-actions">
              <button onClick={newProject}>blank program</button>
              {currentId && <button onClick={() => setShowNew(false)}>cancel</button>}
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="confirm-box">
            <p>Delete this project? This cannot be undone.</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmDelete(null)}>cancel</button>
              <button className="danger" onClick={() => removeProject(confirmDelete)}>delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

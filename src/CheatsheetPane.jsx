// CheatsheetPane — c64lua's own docs, staged from the package into /docs so the
// reference always matches the installed compiler.
import { useEffect, useState } from "react";

const DOC_ORDER = ["CHEATSHEET.md", "DIFFERENCES.md", "ASSETS.md"];

export default function CheatsheetPane() {
  const [docs, setDocs] = useState(null);
  const [which, setWhich] = useState(DOC_ORDER[0]);
  const [text, setText] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const found = [];
      for (const d of DOC_ORDER) {
        const r = await fetch(`/docs/${d}`);
        if (r.ok) found.push(d);
      }
      if (!live) return;
      setDocs(found);
      if (found.length && !found.includes(which)) setWhich(found[0]);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`/docs/${which}`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => { if (live) setText(t); })
      .catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [which]);

  return (
    <div className="pane-scroll cheatsheet">
      {docs && docs.length > 1 && (
        <div className="tabs sub">
          {docs.map((d) => (
            <button key={d} className={"tab " + (which === d ? "active" : "")}
              onClick={() => setWhich(d)}>{d.replace(/\.md$/, "")}</button>
          ))}
        </div>
      )}
      <pre className="doc-text">{text || "loading…"}</pre>
    </div>
  );
}

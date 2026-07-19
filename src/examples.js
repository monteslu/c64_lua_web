// examples.js — the gallery, staged into /examples by
// scripts/stage-toolchain.mjs from the c64lua package, so it always matches the
// installed compiler. Each entry: { name, blurb, files: [...] }.

let cached = null;

export async function loadExamples() {
  if (cached) return cached;
  const r = await fetch("/examples/manifest.json");
  if (!r.ok) throw new Error(`fetch examples manifest: ${r.status}`);
  cached = (await r.json()).examples;
  return cached;
}

/**
 * An example's files, project-shaped, ready for createProject().
 * @param {{name:string, files:string[]}} example
 */
export async function loadExampleFiles(example) {
  const files = {};
  for (const f of example.files) {
    const r = await fetch(`/examples/${example.name}/${f}`);
    if (!r.ok) throw new Error(`fetch example file ${f}: ${r.status}`);
    files[f] = f.endsWith(".lua") ? await r.text() : new Uint8Array(await r.arrayBuffer());
  }
  return files;
}

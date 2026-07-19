// Editor — Monaco with c64lua intelligence.
//
// The language service itself is luacretro-web's; what stays here is the c64lua
// MANIFEST: which builtins table and which compile(). The C64 target has no
// extra namespace (c64lua exports MEMBERS as null) — the whole API is the
// PICO-8-style verb set, so there is no memberNs to register.
import { LuaEditor } from "luacretro-web/editor";
import { compile } from "c64lua/compiler/index.js";
import { BUILTINS, CALLBACKS } from "c64lua/compiler/builtins.js";

const LANGUAGE = {
  builtins: BUILTINS,
  callbacks: CALLBACKS,
  owner: "c64lua",
  callbackDoc: "c64lua lifecycle callback",
};

const compileSrc = (src) => compile(src, "main.lua");

export default function Editor({ value, onChange, onPlay, apiRef }) {
  return (
    <LuaEditor
      value={value}
      onChange={onChange}
      onPlay={onPlay}
      apiRef={apiRef}
      language={LANGUAGE}
      compile={compileSrc}
    />
  );
}

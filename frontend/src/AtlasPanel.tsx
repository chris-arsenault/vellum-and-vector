import { useState, type ReactNode } from "react";
import type { EditorState } from "./useEditor";
import { FeatureRegistry } from "./FeatureRegistry";

export function AtlasPanel({ editor, maps }: { editor: EditorState; maps: ReactNode }) {
  const [tab, setTab] = useState("maps");
  return (
    <>
      <nav className="panel-tabs" aria-label="Atlas contents">
        <button aria-pressed={tab === "maps"} onClick={() => setTab("maps")}>
          Maps
        </button>
        <button aria-pressed={tab === "features"} onClick={() => setTab("features")}>
          Features
        </button>
      </nav>
      {tab === "maps" ? maps : <FeatureRegistry editor={editor} />}
    </>
  );
}

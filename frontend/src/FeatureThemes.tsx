import { useMemo, useState } from "react";
import type { EditorState } from "./useEditor";
function countFeatures(features: EditorState["world"]["features"]) {
  const result = new Map<string, number>();
  for (const f of Object.values(features)) result.set(f.layerId, (result.get(f.layerId) ?? 0) + 1);
  return result;
}

const familyNames: Record<string, string> = {
  physical: "Terrain & geology",
  water: "Water",
  transport: "Routes",
  built: "Places & buildings",
  political: "Politics",
  cultural: "Culture",
  magic: "Magic",
  custom: "Custom layers",
};
export function FeatureThemes({
  editor,
  edit,
}: {
  editor: EditorState;
  edit: (target: string) => void;
}) {
  const [empty, setEmpty] = useState(false);
  const [search, setSearch] = useState("");
  const counts = useMemo(() => countFeatures(editor.world.features), [editor.world.features]);
  const layers = editor.styles.filter(
    (s) =>
      (empty || counts.has(s.layerId)) &&
      editor.world.layers[s.layerId].name.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <details className="feature-themes">
      <summary>
        Features <small>{Object.values(editor.world.features).length.toLocaleString()}</small>
      </summary>
      <label>
        Search features
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />
        Show empty layers
      </label>
      {Object.entries(familyNames).map(([family, title]) => {
        const members = layers.filter((s) => editor.world.layers[s.layerId].family === family);
        if (!members.length) return null;
        return (
          <details key={family} open={Boolean(search)}>
            <summary>
              {title} <small>{members.length}</small>
            </summary>
            {members.map((style) => {
              const name = editor.world.layers[style.layerId].name;
              return (
                <div className="feature-row" key={style.layerId}>
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={`Show ${name}`}
                      checked={style.visible}
                      onChange={(e) =>
                        editor.setStyles(
                          editor.styles.map((s) =>
                            s.layerId === style.layerId ? { ...s, visible: e.target.checked } : s
                          )
                        )
                      }
                    />
                    {name}
                    <small>{counts.get(style.layerId) ?? 0}</small>
                  </label>
                  <button
                    className="quiet"
                    aria-label={`Style ${name}`}
                    onClick={() => edit(`vector:${style.layerId}`)}
                  >
                    Style
                  </button>
                </div>
              );
            })}
          </details>
        );
      })}
    </details>
  );
}

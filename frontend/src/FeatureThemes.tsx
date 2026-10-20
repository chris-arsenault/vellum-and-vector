import { useMemo, useState } from "react";
import type { EditorState } from "./useEditor";
import type { LayerStyle } from "./types";
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
    <details className="feature-themes" open>
      <summary>
        Features <small>{Object.values(editor.world.features).length.toLocaleString()}</small>
      </summary>
      <div className="feature-filters">
        <input
          type="search"
          aria-label="Search features"
          placeholder="Filter feature layers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            aria-label="Show empty layers"
            checked={empty}
            onChange={(e) => setEmpty(e.target.checked)}
          />
          Empty layers
        </label>
      </div>
      {Object.entries(familyNames).map(([family, title]) => {
        const members = layers.filter((s) => editor.world.layers[s.layerId].family === family);
        if (!members.length) return null;
        return (
          <details className="feature-group" key={`${family}:${Boolean(search)}`} open>
            <summary>
              {title} <small title={`${members.length} layers`}>{members.length}</small>
            </summary>
            {members.map((style) => (
              <FeatureRow
                key={style.layerId}
                editor={editor}
                edit={edit}
                presentation={style}
                count={counts.get(style.layerId) ?? 0}
              />
            ))}
          </details>
        );
      })}
    </details>
  );
}
function FeatureRow({
  editor,
  edit,
  presentation,
  count,
}: {
  editor: EditorState;
  edit: (target: string) => void;
  presentation: LayerStyle;
  count: number;
}) {
  const layer = editor.world.layers[presentation.layerId];
  return (
    <div className="feature-row">
      <label className="check">
        <input
          type="checkbox"
          aria-label={`Show ${layer.name}`}
          checked={presentation.visible}
          onChange={(e) =>
            editor.setStyles(
              editor.styles.map((s) =>
                s.layerId === presentation.layerId ? { ...s, visible: e.target.checked } : s
              )
            )
          }
        />
        <svg className="layer-symbol" viewBox="0 0 16 16" aria-hidden="true">
          {layer.representation === "network" ? (
            <path
              d="M1 13L5 4L10 10L15 2"
              fill="none"
              stroke={presentation.color}
              strokeWidth="2"
            />
          ) : (
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              fill={presentation.color}
              fillOpacity="0.25"
              stroke={presentation.color}
            />
          )}
        </svg>
        <span className="feature-name" title={layer.name}>
          {layer.name}
        </span>
        <small>{count.toLocaleString()}</small>
      </label>
      <button
        className="quiet"
        aria-label={`Style ${layer.name}`}
        onClick={() => edit(`vector:${presentation.layerId}`)}
      >
        Style
      </button>
    </div>
  );
}

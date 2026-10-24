import { useState } from "react";
import { societyWorkLayers, type AtlasFeature, type SocietyWorkKind } from "@atlas/domain";
import type { EditorState } from "./useEditor";

export function SocietyWorkForm({
  feature,
  editor,
}: {
  feature: AtlasFeature;
  editor: EditorState;
}) {
  const [kind, setKind] = useState("conservation"),
    [radius, setRadius] = useState(1000),
    [magnitude, setMagnitude] = useState(1);
  if (feature.kind !== "settlement") return null;
  return (
    <details>
      <summary>Place environmental work</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          editor.saveFeature(authoredWork(feature, kind, radius, magnitude));
        }}
      >
        <label>
          Work
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.keys(societyWorkLayers).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Radius (metres)
          <input
            type="number"
            min="1"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </label>
        <label>
          Magnitude
          <input
            type="number"
            min="0"
            step="any"
            value={magnitude}
            onChange={(e) => setMagnitude(Number(e.target.value))}
          />
        </label>
        <p className="hint">
          Place here, then move the work on the map. Regenerating society refreshes present terrain
          and water effects while retaining completed eras.
        </p>
        <button type="submit">Place work</button>
      </form>
    </details>
  );
}
function authoredWork(
  feature: AtlasFeature,
  kind: string,
  radius: number,
  magnitude: number
): AtlasFeature {
  return {
    ...feature,
    id: crypto.randomUUID(),
    kind,
    layerId: societyWorkLayers[kind as SocietyWorkKind],
    name: `${kind} at ${feature.name}`,
    state: "authored",
    protected: true,
    detail: {},
    relations: [],
    generationId: null,
    attributes: {
      workKind: kind,
      communityId: feature.attributes.communityId,
      radius,
      magnitude,
      maintained: true,
    },
    causes: ["Placed by the creator. Regenerate society to refresh present environmental effects."],
  };
}

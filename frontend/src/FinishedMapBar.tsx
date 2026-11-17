import type { FinishedMapModel } from "./FinishedMapEditor";
import { FinishedSave } from "./FinishedSave";
import { download } from "./download";

// owner-direction(2026-11-17): group parent navigation and regeneration with the current map's controls
export function FinishedMapBar({ model }: { model: FinishedMapModel }) {
  const { props, map, context, value, navigation, setError } = model;
  return (
    <div className="finished-map-bar" aria-label="Current map controls" role="region">
      <nav aria-label="Map navigation" className="finished-map-location">
        {map.parent && (
          <button aria-label="Parent map" onClick={() => props.open(map.parent!)}>
            ↑ Parent map
          </button>
        )}
        <span>{map.realScale ? "Real-scale map" : map.parent ? "Regional map" : "World map"}</span>
      </nav>
      <div className="finished-map-actions" role="group" aria-label="Map actions">
        <FinishedSave
          {...props}
          value={value}
          navigation={navigation.state}
          edits={map.realScale?.edits ?? 0}
        />
        <button
          onClick={() =>
            void context.maps
              .export(map.reference, "geojson")
              .then(
                (asset) =>
                  download(
                    `${map.name}.geojson`,
                    new Blob([new Uint8Array(asset.bytes)], { type: asset.mediaType })
                  ),
                setError
              )
          }
        >
          Export GIS
        </button>
        <button
          onClick={props.regenerate}
          disabled={map.state !== "complete" || !!map.realScale?.edits}
          title={map.realScale?.edits ? "Edited by hand; regenerating would replace it" : undefined}
        >
          Regenerate map
        </button>
      </div>
    </div>
  );
}

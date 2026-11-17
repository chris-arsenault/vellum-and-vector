import type { MapDescriptor, MapReader } from "@atlas/map";
import type { PublishedPresentation } from "./PublishedMapView";
import { defaultRealScalePresentation, hexLabel, type RealScalePresentation } from "./realScale";
import { RealScaleKey } from "./RealScaleKey";
import { RealScaleLevel } from "./RealScaleLevel";
import { RealScaleSite } from "./RealScaleSite";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
  value: PublishedPresentation;
  change(value: PublishedPresentation): void;
}
/** View choices for a real-scale map: how hexes show, which units, which creator layers,
 * and the numbered key of its places. */
export function RealScaleControls({ map, reader, value, change }: Props) {
  const real = map.realScale;
  if (!real) return null;
  const view = value.realScale ?? defaultRealScalePresentation();
  const set = (next: Partial<RealScalePresentation>) =>
    change({ ...value, realScale: { ...view, ...next } });
  return (
    <section aria-label="Real-scale map">
      <h2>Real-scale map</h2>
      <p>
        {real.kind === "ground" ? "Ground map" : "Building floors"} · {hexLabel(real, view.units)}
      </p>
      <RealScaleLevel map={map} view={view} set={set} />
      <RealScaleSite map={map} reader={reader} units={view.units} />
      <fieldset>
        <legend>Hexes</legend>
        {(["grid", "fill"] as const).map((hexView) => (
          <label key={hexView} className="check">
            <input
              type="radio"
              name="hex-view"
              checked={view.hexView === hexView}
              onChange={() => set({ hexView })}
            />
            {hexView === "grid" ? "Grid over the map" : "Fill each hex by what covers it"}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Units</legend>
        {(["metres", "feet"] as const).map((units) => (
          <label key={units} className="check">
            <input
              type="radio"
              name="real-scale-units"
              checked={view.units === units}
              onChange={() => set({ units })}
            />
            {units === "metres" ? "Metres" : "Feet"}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Creator layers</legend>
        {real.creatorLayers.map((layer) => (
          <label key={layer.id} className="check">
            <input
              type="checkbox"
              checked={!view.hidden.includes(layer.id)}
              onChange={(event) =>
                set({
                  hidden: event.target.checked
                    ? view.hidden.filter((id) => id !== layer.id)
                    : [...view.hidden, layer.id],
                })
              }
            />
            Show {layer.name}
          </label>
        ))}
      </fieldset>
      <RealScaleKey map={map} reader={reader} />
    </section>
  );
}

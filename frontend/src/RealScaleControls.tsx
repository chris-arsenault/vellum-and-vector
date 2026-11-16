import type { MapDescriptor } from "@atlas/map";
import type { PublishedPresentation } from "./PublishedMapView";
import { defaultRealScalePresentation, hexLabel, type RealScalePresentation } from "./realScale";

interface Props {
  map: MapDescriptor;
  value: PublishedPresentation;
  change(value: PublishedPresentation): void;
}
/** View choices for a real-scale map: how hexes show, which units, which creator layers. */
export function RealScaleControls({ map, value, change }: Props) {
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
    </section>
  );
}

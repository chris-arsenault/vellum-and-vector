import type { ReactNode } from "react";
import type { CartographicPresentation } from "./types";
import "./drawnMap.css";

export function MapAppearanceControls({
  value,
  update,
  raster,
}: {
  value: CartographicPresentation;
  update(change: Partial<CartographicPresentation>): void;
  raster: ReactNode;
}) {
  return (
    <section className="map-appearance" aria-label="Map appearance">
      <fieldset className="presentation-choices">
        <legend>Presentation</legend>
        <label className="presentation-choice" aria-label="Raster investigation">
          <input
            type="radio"
            name="presentation"
            aria-label="Raster investigation"
            checked={value.mode === "raster"}
            onChange={() => update({ mode: "raster" })}
          />
          <span>
            <strong>Raster investigation</strong>
            <small>Terrain, contours and data fields</small>
          </span>
        </label>
        <label className="presentation-choice" aria-label="Drawn map">
          <input
            type="radio"
            name="presentation"
            aria-label="Drawn map"
            checked={value.mode === "drawn"}
            onChange={() => update({ mode: "drawn" })}
          />
          <span>
            <strong>Drawn map</strong>
            <small>Illustration, names and atlas styling</small>
          </span>
        </label>
      </fieldset>
      {value.mode === "drawn" ? <DrawnAppearance value={value} update={update} /> : raster}
    </section>
  );
}
function DrawnAppearance({
  value,
  update,
}: {
  value: CartographicPresentation;
  update: (change: Partial<CartographicPresentation>) => void;
}) {
  return (
    <>
      <label className="map-theme">
        Map theme
        <select
          aria-label="Map theme"
          value={value.subject}
          onChange={(event) => update({ subject: event.target.value as typeof value.subject })}
        >
          <option value="physical">Physical geography</option>
          <option value="political">Political atlas</option>
          <option value="cultural">Cultures and languages</option>
          <option value="infrastructure">Settlements and routes</option>
        </select>
      </label>
      <DrawingStyles value={value} update={update} />
      <fieldset className="map-control-group">
        <legend>Terrain and names</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={value.terrain}
            onChange={(e) => update({ terrain: e.target.checked })}
          />
          Illustrated terrain
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.labels}
            onChange={(e) => update({ labels: e.target.checked })}
          />
          Map names
        </label>
        <label className="illustration-density">
          Illustration density <output>{value.density.toFixed(1)}×</output>
          <input
            aria-label="Illustration density"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={value.density}
            onChange={(e) => update({ density: Number(e.target.value) })}
          />
        </label>
      </fieldset>
    </>
  );
}
function DrawingStyles({
  value,
  update,
}: {
  value: CartographicPresentation;
  update: (change: Partial<CartographicPresentation>) => void;
}) {
  return (
    <fieldset className="drawing-style-choices">
      <legend>Drawing style</legend>
      {(
        [
          ["wash", "Ink and colour wash"],
          ["ink", "Monochrome ink"],
        ] as const
      ).map(([id, label]) => (
        <label className={`drawing-style-choice ${id}`} key={id}>
          <input
            type="radio"
            name="drawing-style"
            checked={value.style === id}
            onChange={() => update({ style: id })}
            aria-label={label}
          />
          <svg viewBox="0 0 140 52" aria-hidden="true">
            <path className="style-water" d="M0 0h140v52H0Z" />
            <path className="style-land" d="M0 0h95q-30 8-13 20t-25 32H0Z" />
            <path
              className="style-marks"
              d="m9 38 10-19 11 19m-16-9 5-10 5 10m8 2 12-22 13 22m-18-13 5-9 5 9m-2 29 10-18 10 18M89 11q-7 8 3 17t-15 20"
            />
          </svg>
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

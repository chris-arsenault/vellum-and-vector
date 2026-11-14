import { useState } from "react";
import { bounds as geometryBounds } from "./presentation";
import type { Geometry } from "geojson";
import type { RenderFeature } from "./renderFeature";

export interface SurveyObservation {
  epoch: string;
  geometry: Geometry;
}
export function SurveyHistory({
  feature,
  observations,
}: {
  feature: RenderFeature;
  observations: SurveyObservation[];
}) {
  return (
    <details>
      <summary>Wild-zone displacement</summary>
      <p className="hint">
        Surveyed footprints follow this zone only while successive surveys overlap. Separate patches
        are not inferred movements.
      </p>
      {observations.length ? (
        <SurveyComparison feature={feature} observations={observations} />
      ) : (
        <p className="hint">No earlier footprint was recorded for this zone.</p>
      )}
    </details>
  );
}

function SurveyComparison({
  feature,
  observations,
}: {
  feature: RenderFeature;
  observations: SurveyObservation[];
}) {
  const [selected, setSelected] = useState(0),
    historical = observations[selected] ?? observations[0],
    current = feature.footprint ?? feature.geometry,
    bounds = geometryBounds({
      type: "GeometryCollection",
      geometries: [current, ...observations.map((item) => item.geometry)],
    }),
    width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    padding = Math.max(width, height) * 0.05;
  return (
    <>
      <label>
        Earlier survey
        <select
          aria-label="Earlier survey"
          value={selected}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          {observations.map((item, index) => (
            <option key={index} value={index}>
              {item.epoch}
            </option>
          ))}
        </select>
      </label>
      <svg
        role="img"
        aria-label="Earlier surveyed and current wild-zone footprints"
        width="100%"
        height="220"
        viewBox={`${bounds[0] - padding} ${-bounds[3] - padding} ${width + 2 * padding} ${height + 2 * padding}`}
      >
        <path
          aria-label="Current footprint"
          d={footprintPath(current)}
          fill="#8e55aa"
          fillOpacity="0.3"
          stroke="#8e55aa"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          fillRule="evenodd"
        />
        <path
          aria-label="Earlier surveyed footprint"
          d={footprintPath(historical.geometry)}
          fill="none"
          stroke="#d49738"
          strokeWidth="2"
          strokeDasharray="5 3"
          vectorEffect="non-scaling-stroke"
          fillRule="evenodd"
        />
      </svg>
      <p className="hint">
        Dashed amber: earlier survey ({historical.epoch}). Solid purple: current footprint. North is
        up; both use the same coordinates.
      </p>
    </>
  );
}

/** SVG coordinates only; geographic operations stay in the spatial adapter. */
function footprintPath(geometry: Geometry): string {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons
    .flatMap((polygon) =>
      polygon.map(
        (ring) => ring.map(([x, y], index) => `${index ? "L" : "M"}${x},${-y}`).join(" ") + " Z"
      )
    )
    .join(" ");
}

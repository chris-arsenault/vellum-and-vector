import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { spatial, type EpochHistory } from "@atlas/domain";
import type { Geometry } from "geojson";
import { atlasWorkspace } from "./atlasWorkspace";
import { ErrorMessage } from "./ErrorMessage";
import type { AtlasFeature, World } from "./types";

export function WildZoneHistory({ world, feature }: { world: World; feature: AtlasFeature }) {
  return feature.kind === "veil:wild" ? <WildZoneSurveys world={world} feature={feature} /> : null;
}
function WildZoneSurveys({ world, feature }: { world: World; feature: AtlasFeature }) {
  const history = useQuery({
    queryKey: ["field-history", world.id, world.version, feature.areaId],
    queryFn: async () => (await atlasWorkspace()).readCauses(world.id, feature.areaId),
  });
  const observations = surveysOf(history.data ?? [], feature.id);
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
      <ErrorMessage error={history.error} />
    </details>
  );
}

function surveysOf(history: EpochHistory[], id: string) {
  return history.flatMap((epoch) =>
    epoch.causes.flatMap((cause) => {
      if (cause.kind !== "geography" || cause.featureKind !== "veil:wild") return [];
      const observation = cause.observations.find((item) => item.id === id);
      return observation
        ? [
            {
              epoch: epoch.ancestry.map((item) => item.id).join(" / "),
              geometry: observation.geometry,
            },
          ]
        : [];
    })
  );
}

function SurveyComparison({
  feature,
  observations,
}: {
  feature: AtlasFeature;
  observations: ReturnType<typeof surveysOf>;
}) {
  const [selected, setSelected] = useState(0),
    historical = observations[selected] ?? observations[0],
    current = feature.footprint ?? feature.geometry,
    bounds = spatial.bounds({
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
        <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
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

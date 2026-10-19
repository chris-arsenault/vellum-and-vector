import type { Geometry } from "geojson";
import type { AtlasFeature } from "./model";
import type { DomainSnapshot } from "./operations";
import { featureStation, sampleFields } from "./boundaryContracts";
import { lineParts } from "./lineStations";
import { requireThat } from "./errors";
import { sameValue } from "./values";
import { valueRecordSchema, type Value } from "./schemas";

const stations = [
  "elevations",
  "discharges",
  "junctionInflows",
  "widths",
  "depths",
  "catchmentAreas",
  "floorElevations",
  "floodDepths",
];
function sourceProfile(
  snapshot: DomainSnapshot,
  previous: AtlasFeature | undefined,
  geometry: Geometry,
  channel: string,
  input: Record<string, Value>
): number[] | null {
  const points = lineParts(geometry).flat();
  const values = points.map((p) => {
    if (channel === "elevations" && p[2] !== undefined) return p[2];
    const position = { x: p[0], y: p[1], z: p[2] ?? 0 },
      old = previous ? featureStation(snapshot, previous, channel, position) : null;
    if (old !== null) return old;
    return fallbackProfile(snapshot, position, channel, input);
  });
  return values.every((v) => v !== null) ? values : null;
}
function fallbackProfile(
  snapshot: DomainSnapshot,
  p: import("./model").Position,
  channel: string,
  input: Record<string, Value>
) {
  if (channel === "elevations") return sampleFields(snapshot, p).elevation ?? null;
  if (channel === "discharges")
    return typeof input.discharge === "number"
      ? input.discharge
      : (sampleFields(snapshot, p).flow ?? null);
  return null;
}
export function featureAttributes(
  snapshot: DomainSnapshot,
  previous: AtlasFeature | undefined,
  areaId: string,
  geometry: Geometry,
  input: Record<string, unknown>
): Record<string, Value> {
  const result = Object.assign(Object.create(null), valueRecordSchema.parse(input)) as Record<
    string,
    Value
  >;
  const old = previous?.detail[areaId]?.attributes ?? previous?.attributes ?? {};
  if (previous?.generationId) retainHistory(result, old);
  if (!geometry.type.includes("LineString")) return result;
  populateProfiles(snapshot, previous, geometry, result, old);
  validateGeometryHeights(snapshot, geometry, result);
  return result;
}
function validateGeometryHeights(
  snapshot: DomainSnapshot,
  geometry: Geometry,
  attributes: Record<string, Value>
) {
  const values = attributes.elevations;
  if (!Array.isArray(values)) return;
  for (const [i, coordinate] of lineParts(geometry).flat().entries())
    if (coordinate[2] !== undefined)
      requireThat(
        typeof values[i] === "number" &&
          Math.abs((values[i] as number) - coordinate[2]) <=
            (snapshot.world.reference.precision ?? 1e-6),
        "geometry_elevation",
        "Explicit geometry elevations and the station profile must agree."
      );
}
function retainHistory(result: Record<string, Value>, old: Record<string, unknown>) {
  for (const key of ["history", "epochHistory", "historyResources"]) {
    if (!Object.hasOwn(old, key)) continue;
    requireThat(
      !Object.hasOwn(result, key) || sameValue(result[key], old[key]),
      "fixed_history",
      "Ordinary edits retain completed generation history."
    );
    result[key] = old[key] as Value;
  }
}
function populateProfiles(
  snapshot: DomainSnapshot,
  previous: AtlasFeature | undefined,
  geometry: Geometry,
  result: Record<string, Value>,
  old: Record<string, unknown>
) {
  const count = lineParts(geometry).reduce((sum, part) => sum + part.length, 0);
  for (const channel of stations) {
    const provided = result[channel];
    if (Array.isArray(provided) && provided.length === count) {
      requireThat(
        provided.every((v) => typeof v === "number" && Number.isFinite(v)),
        "station_profile",
        `Channel ${channel} needs finite numeric samples.`
      );
      if (
        [
          "discharges",
          "junctionInflows",
          "widths",
          "depths",
          "catchmentAreas",
          "floodDepths",
        ].includes(channel)
      )
        requireThat(
          provided.every((v) => typeof v === "number" && v >= 0),
          "station_profile",
          `Channel ${channel} needs nonnegative samples.`
        );
      continue;
    }
    requireThat(
      provided === undefined || sameValue(provided, old[channel]),
      "station_profile",
      `Channel ${channel} must match the edited geometry's vertices.`
    );
    const resolved = sourceProfile(snapshot, previous, geometry, channel, result);
    if (resolved !== null) result[channel] = resolved;
  }
}

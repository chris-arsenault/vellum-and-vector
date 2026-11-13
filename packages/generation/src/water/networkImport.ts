import {
  interpolateProfile,
  lineParts,
  spatial,
  rectangle,
  point,
  type DrainageNetwork,
  type RetainedRiver,
  type AtlasFeature,
} from "@atlas/domain";
import type { LineString } from "geojson";
import type { PhysicalField } from "../world/field";
import { addReach } from "./reachEvolution";
import type { Reach } from "./reaches";
import { projectRiverOrders } from "./riverProjection";

type RiverIdentity = Pick<AtlasFeature, "name" | "attributes">;

/** Published drainage has a mean profile; retained generation context additionally carries months and beds. */
function inputs(
  network: DrainageNetwork,
  feature: (id: string) => RiverIdentity | undefined
): RetainedRiver[] {
  if (network.kept) return network.kept.reaches;
  return network.reaches.map((reach, n) => ({
    id: n + 1,
    course: reach.coordinates,
    downstream: reach.downstream === null ? null : reach.downstream + 1,
    order: reach.order,
    flow: reach.discharges.at(-1) ?? 0,
    least: reach.discharges.at(-1) ?? 0,
    flood: reach.discharges.at(-1) ?? 0,
    months: 12,
    dry: false,
    drawn: reach.featureIds.length > 0,
    former: [],
    monthly: reach.discharges.flatMap((flow) => Array(12).fill(flow)),
    catchment: reach.catchmentAreas,
    bed: [],
    width: [],
    depth: [],
    leakage: [],
    river: reach.featureIds[0]
      ? String(feature(reach.featureIds[0])?.attributes.riverId ?? reach.featureIds[0])
      : undefined,
    name: reach.featureIds[0] ? feature(reach.featureIds[0])?.name : undefined,
  }));
}

/**
 * Import the captured network as objects on the shared lattice. GEOS clips and resamples
 * its lines; a child owns the resulting courses and may subsequently change them freely.
 */
export function inheritRivers(
  map: PhysicalField,
  network: DrainageNetwork,
  feature: (id: string) => RiverIdentity | undefined = () => undefined
) {
  if (map.rivers.reaches.size || !network.input) return;
  const records = inputs(network, feature),
    ids = new Map<number, number[]>();
  for (const record of records) {
    ids.set(record.id, importRecord(map, record));
  }
  for (const record of records) {
    const imported = ids.get(record.id) ?? [];
    imported.forEach((id, n) => {
      map.rivers.reaches.get(id)!.downstream =
        imported[n + 1] ??
        (record.downstream === null ? null : (ids.get(record.downstream)?.[0] ?? null));
    });
  }
  map.rivers.at = undefined;
  projectRiverOrders(map);
}

function importRecord(map: PhysicalField, record: RetainedRiver) {
  const imported: number[] = [];
  for (const line of clippedLines(map, record.course)) {
    const reach = importReach(map, record, line);
    if (reach) imported.push(reach.id);
  }
  if (imported.length) return imported;
  for (const former of record.former)
    for (const line of clippedLines(map, former.course)) {
      const reach = importReach(map, { ...record, dry: true, months: 0 }, line);
      if (reach) imported.push(reach.id);
    }
  return imported;
}

function clippedLines(map: PhysicalField, coordinates: [number, number][]) {
  if (coordinates.length < 2) return [];
  const [w, s, e, n] = map.mesh.bounds,
    [x, y] = map.mesh.origin,
    clipped = spatial.clipByRect({ type: "LineString", coordinates }, [w + x, s + y, e + x, n + y]);
  return clipped
    ? lineParts(clipped).map((coordinates): LineString => ({ type: "LineString", coordinates }))
    : [];
}

function importReach(map: PhysicalField, input: RetainedRiver, line: LineString): Reach | null {
  const sampled = spatial.resampleTrace(line, 0, map.mesh.spacing / 3),
    cells = sampled.coordinates
      .map(([x, y]) => map.mesh.cellAt(x - map.mesh.origin[0], y - map.mesh.origin[1]))
      .filter((cell, n, all) => cell >= 0 && (n === 0 || cell !== all[n - 1]));
  if (!cells.length) return null;
  const reach = addReach(map.rivers, cells);
  reach.order = input.order;
  reach.dry = input.dry;
  reach.drawn = input.drawn;
  reach.river = input.river;
  reach.name = input.name;
  reach.record = input.river ? `river:${input.river}:0` : input.record;
  reach.months = input.months;
  reach.flow = input.flow;
  reach.least = input.least;
  reach.flood = input.flood;
  const target: LineString = {
      type: "LineString",
      coordinates: cells.map((cell) => [
        map.mesh.x(cell) + map.mesh.origin[0],
        map.mesh.y(cell) + map.mesh.origin[1],
      ]),
    },
    source: LineString = { type: "LineString", coordinates: input.course };
  for (let month = 0; month < 12; month++) {
    const values = input.course.map((_, at) => input.monthly[at * 12 + month]),
      flow = interpolateProfile(source, { flow: values }, target, "flow")!;
    flow.forEach((value, at) => {
      reach.monthly[at * 12 + month] = value;
    });
  }
  if (input.dry) reach.monthly.fill(0);
  importProfiles(map, reach, input, source, target);
  const [w, s, e, n] = map.mesh.bounds,
    [ox, oy] = map.mesh.origin;
  if (
    !input.dry &&
    !spatial.covers(
      rectangle([w + ox, s + oy, e + ox, n + oy]),
      point({ x: input.course[0][0], y: input.course[0][1], z: 0 })
    )
  )
    map.rivers.entries.push({
      cell: cells[0],
      monthly: reach.monthly.slice(0, 12),
      catchment: reach.catchment[0],
    });
  reach.former = input.former.flatMap((course) =>
    clippedLines(map, course.course).map((line) => ({
      cells: spatial
        .resampleTrace(line, 0, map.mesh.spacing / 3)
        .coordinates.map(([x, y]) =>
          map.mesh.cellAt(x - map.mesh.origin[0], y - map.mesh.origin[1])
        )
        .filter((cell) => cell >= 0),
      leftIn: course.leftIn,
    }))
  );
  return reach;
}

function importProfiles(
  map: PhysicalField,
  reach: Reach,
  input: RetainedRiver,
  source: LineString,
  target: LineString
) {
  for (const part of ["bed", "width", "depth", "leakage", "catchment"] as const) {
    if (input[part].length)
      reach[part] = Float64Array.from(
        interpolateProfile(source, { value: input[part] }, target, "value")!
      );
    else if (part === "bed")
      reach.bed = Float64Array.from(reach.cells, (cell) => map.Elevation.get(cell));
  }
}

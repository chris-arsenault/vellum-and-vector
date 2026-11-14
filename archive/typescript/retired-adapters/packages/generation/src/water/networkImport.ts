import {
  interpolateProfile,
  lineParts,
  spatial,
  rectangle,
  retainedRiverTrace,
  type DrainageNetwork,
  type RetainedRiver,
  type RetainedRiverNetwork,
  type AtlasFeature,
} from "@atlas/domain";
import type { LineString } from "geojson";
import type { PhysicalField } from "../world/field";
import { addReach } from "./reachEvolution";
import type { Reach } from "./reaches";
import { projectRiverOrders } from "./riverProjection";
import { riverStorage } from "./riverStorage";
import { edgeLeadingTo } from "../world/mesh";

type RiverIdentity = Pick<AtlasFeature, "name" | "attributes">;
interface ImportedRiver {
  ids: number[];
  outlet: number | undefined;
}

/** Published drainage has a mean profile; retained generation context additionally carries months and beds. */
function inputs(
  network: DrainageNetwork,
  feature: (id: string) => RiverIdentity | undefined
): RetainedRiver[] {
  if (network.kept) return network.kept.reaches;
  return network.reaches.map((reach, n) => {
    const junction = publishedJunction(network, n),
      course = junction ? reach.coordinates.slice(0, -1) : reach.coordinates,
      discharges = reach.discharges.slice(0, course.length),
      flow = discharges.at(-1) ?? 0;
    return {
      id: n + 1,
      course,
      junction,
      downstream: reach.downstream === null ? null : reach.downstream + 1,
      order: reach.order,
      flow,
      least: flow,
      flood: flow,
      months: 12,
      dry: false,
      drawn: reach.featureIds.length > 0,
      former: [],
      monthly: discharges.flatMap((flow) => Array(12).fill(flow)),
      catchment: reach.catchmentAreas.slice(0, course.length),
      bed: [],
      width: [],
      depth: [],
      leakage: [],
      river: reach.featureIds[0]
        ? String(feature(reach.featureIds[0])?.attributes.riverId ?? reach.featureIds[0])
        : undefined,
      name: reach.featureIds[0] ? feature(reach.featureIds[0])?.name : undefined,
    };
  });
}

/** Published lines include their actual shared confluence endpoint. */
function publishedJunction(network: DrainageNetwork, at: number) {
  const reach = network.reaches[at],
    end = reach.coordinates.at(-1),
    receiver =
      reach.downstream === null ? undefined : network.reaches[reach.downstream]?.coordinates[0];
  return end && receiver && end[0] === receiver[0] && end[1] === receiver[1] ? receiver : undefined;
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
  const store = riverStorage(map);
  if (store.reaches.size || store.entries.length || !network.input) return;
  importEntries(map, network.kept?.entries ?? []);
  const records = inputs(network, feature),
    ids = new Map<number, ImportedRiver>();
  for (const record of records) {
    ids.set(record.id, importRecord(map, record));
  }
  for (const record of records) linkJunction(map, record, ids);
  store.at = undefined;
  projectRiverOrders(map);
}

/** Only a verified local confluence is a child edge; clipped re-entry pieces stay separate. */
function linkJunction(map: PhysicalField, record: RetainedRiver, ids: Map<number, ImportedRiver>) {
  const outlet = ids.get(record.id)?.outlet;
  if (outlet === undefined || record.downstream === null || !record.junction) return;
  const store = riverStorage(map),
    cell = pointCell(map, record.junction),
    receiving = ids
      .get(record.downstream)
      ?.ids.find((id) => store.reaches.get(id)!.cells[0] === cell),
    reach = store.reaches.get(outlet)!;
  if (receiving !== undefined && edgeLeadingTo(map.mesh, reach.cells.at(-1)!, cell) >= 0)
    reach.downstream = receiving;
}

/** Existing captured boundary supply remains actual supply when the child shares that edge. */
function importEntries(map: PhysicalField, entries: RetainedRiverNetwork["entries"]) {
  const [w, s, e, n] = map.mesh.bounds,
    [ox, oy] = map.mesh.origin,
    inside = spatial.pointCoverage(rectangle([w + ox, s + oy, e + ox, n + oy]));
  for (const entry of entries) {
    const [x, y] = entry.position;
    if (!inside({ x, y, z: 0 })) continue;
    const cell = map.mesh.cellAt(x - ox, y - oy);
    if (cell < 0) continue;
    riverStorage(map).entries.push({
      cell,
      monthly: Float64Array.from(entry.monthly),
      catchment: entry.catchment,
    });
  }
}

function importRecord(map: PhysicalField, record: RetainedRiver) {
  const current = importCurrent(map, record);
  if (current.ids.length) return current;
  for (const former of record.former) {
    const input: RetainedRiver = {
      ...record,
      course: former.course,
      junction: undefined,
      downstream: null,
      dry: true,
      driedIn: former.leftIn,
      flow: 0,
      least: 0,
      flood: 0,
      months: 0,
      monthly: Array(former.course.length * 12).fill(0),
      bed: [],
      width: [],
      depth: [],
      leakage: [],
      catchment: [],
      former: [],
    };
    for (const line of clippedLines(map, former.course)) importReach(map, input, line);
  }
  // Former paths carry no present downstream relationship.
  return current;
}

function importCurrent(map: PhysicalField, record: RetainedRiver): ImportedRiver {
  const imported: number[] = [],
    current = directedInput(record);
  let outlet: number | undefined;
  if (current)
    for (const line of clippedLines(map, current.course)) {
      const reach = importReach(map, current, line);
      if (reach) imported.push(reach.id);
      outlet = reach?.id;
    }
  else {
    const reach = importPoint(map, record);
    if (reach) imported.push(reach.id);
  }
  if (!record.junction || pointCell(map, record.junction) < 0) outlet = undefined;
  return { ids: imported, outlet };
}

/** Interpolation follows the actual directed edge; the junction carries outgoing tributary water. */
function directedInput(record: RetainedRiver): RetainedRiver | null {
  const trace = retainedRiverTrace(record);
  if (!trace) return null;
  const profile = (values: number[]) =>
    values.length ? trace.sampleIndices.map((at) => values[at]) : [];
  return {
    ...record,
    course: trace.geometry.coordinates.map(([x, y]) => [x, y]),
    monthly: trace.sampleIndices.flatMap((at) => record.monthly.slice(at * 12, (at + 1) * 12)),
    catchment: profile(record.catchment),
    bed: profile(record.bed),
    width: profile(record.width),
    depth: profile(record.depth),
    leakage: profile(record.leakage),
  };
}

function clippedLines(map: PhysicalField, coordinates: [number, number][]) {
  if (coordinates.length < 2) return [];
  const [w, s, e, n] = map.mesh.bounds,
    [x, y] = map.mesh.origin,
    clipped = spatial.clipTrace(
      { type: "LineString", coordinates },
      rectangle([w + x, s + y, e + x, n + y])
    );
  return clipped
    ? lineParts(clipped).map((coordinates): LineString => ({ type: "LineString", coordinates }))
    : [];
}

function importReach(map: PhysicalField, input: RetainedRiver, line: LineString): Reach | null {
  const sampled = spatial.resampleTrace(line, 0, map.mesh.spacing / 3),
    cells = sampled.coordinates
      .map(([x, y]) => map.mesh.cellAt(x - map.mesh.origin[0], y - map.mesh.origin[1]))
      .filter((cell, n, all) => cell >= 0 && (n === 0 || cell !== all[n - 1]));
  if (input.junction) {
    const [x, y] = input.junction,
      receiver = map.mesh.cellAt(x - map.mesh.origin[0], y - map.mesh.origin[1]);
    // The directed edge ends at the receiver, whose sample belongs to its own reach.
    if (cells.at(-1) === receiver) cells.pop();
  }
  if (!cells.length) return null;
  const reach = initializeReach(map, input, cells),
    target: LineString = {
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
  const [x, y] = line.coordinates[0];
  if (!input.dry && spatial.lineFraction(source, { x, y, z: 0 }) > 0)
    riverStorage(map).entries.push({
      cell: cells[0],
      monthly: reach.monthly.slice(0, 12),
      catchment: reach.catchment[0],
    });
  return reach;
}

/** An isolated retained sample remains a point, without an invented direction or boundary supply. */
function importPoint(map: PhysicalField, input: RetainedRiver): Reach | null {
  if (input.course.length !== 1) return null;
  const cell = pointCell(map, input.course[0]);
  if (cell < 0) return null;
  const reach = initializeReach(map, input, [cell]);
  if (!input.dry) reach.monthly.set(input.monthly);
  for (const part of ["bed", "width", "depth", "leakage", "catchment"] as const)
    reach[part][0] = input[part][0] ?? (part === "bed" ? map.Elevation.get(cell) : 0);
  return reach;
}

function pointCell(map: PhysicalField, [x, y]: [number, number]) {
  const [w, s, e, n] = map.mesh.bounds,
    [ox, oy] = map.mesh.origin;
  return spatial.pointCoverage(rectangle([w + ox, s + oy, e + ox, n + oy]))({ x, y, z: 0 })
    ? map.mesh.cellAt(x - ox, y - oy)
    : -1;
}

function initializeReach(map: PhysicalField, input: RetainedRiver, cells: number[]) {
  const reach = addReach(riverStorage(map), cells);
  reach.order = input.order;
  reach.dry = input.dry;
  reach.driedIn = input.driedIn;
  reach.drawn = input.drawn;
  reach.river = input.river;
  reach.name = input.name;
  reach.record = input.river ? `river:${input.river}:0` : input.record;
  reach.months = input.months;
  reach.flow = input.flow;
  reach.least = input.least;
  reach.flood = input.flood;
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

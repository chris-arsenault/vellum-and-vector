import { chartCopies, chartFootprint, interpolateProfile, MapScale, spatial } from "@atlas/domain";
import type { Geometry, LineString } from "geojson";
import { nativePosition } from "../world/atlasWorkspace";
import { releaseWorking } from "../world/physicalNumerics";
import { meanderReach } from "../world/riverMeanders";
import { createRiverPaths, riverPath, type RiverPaths } from "../world/riverPaths";
import { coordinateKey } from "../world/worldSources";
import {
  generationFeature,
  generationFeatures,
  writeGenerationFeature,
} from "../generationFeatures";
import { generatedFeature, putGenerated, putGeneratedNetwork } from "../mapFeatures";
import type { GenerationState, MapProcessContext } from "../process";
import { reachAt, reachesOf } from "../water/riverKeeping";
import type { Reach } from "../water/reaches";
import { mapScale, worldRiverLength } from "../worldSignificance";
import {
  basinDischarges,
  drawnRivers,
  establishRivers,
  keptReaches,
  riversOf,
} from "./riverCourses";

type Profiles = Record<string, number[]>;
/** One unbroken stretch of a river: its cells head to end, its line and the profiles along it. */
interface Stretch {
  members: number[];
  geometry: LineString;
  profiles: Profiles;
}
/** A line of a river inside the frame, with the profiles along it. */
interface Piece {
  coordinates: number[][];
  profiles: Profiles;
}

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lineParts);
  return [];
}
function drawStretch(state: GenerationState, members: number[], paths: RiverPaths): Stretch {
  const map = state.physical!.map,
    valley = riverPath(map, paths, members),
    // A reach on a floodplain migrates across it; elsewhere it keeps the valley line.
    meandered = meanderReach(map, paths, valley.geometry, valley.profiles, members[0]);
  return {
    members,
    geometry: meandered?.geometry ?? valley.geometry,
    profiles: meandered?.profiles ?? valley.profiles,
  };
}
/** What of one chart copy of a stretch lies in the frame. */
function piecesInFrame(state: GenerationState, copy: LineString, profiles: Profiles): Piece[] {
  const footprint = state.domain.scope.footprint;
  if (!spatial.intersects(copy, footprint)) return [];
  const area = state.domain.world.areas[state.domain.scope.areaId];
  if (area.boundary && spatial.crossings(copy, footprint).length) return [];
  if (spatial.covers(footprint, copy)) return [{ coordinates: copy.coordinates, profiles }];
  const clipped = spatial.intersection(copy, footprint);
  if (!clipped) return [];
  return lineParts(clipped)
    .filter((coordinates) => coordinates.length >= 2)
    .map((coordinates) => ({
      coordinates,
      profiles: Object.fromEntries(
        Object.keys(profiles).map((key) => [
          key,
          interpolateProfile(copy, profiles, { type: "LineString", coordinates }, key)!,
        ])
      ),
    }));
}
/** A river's lines in the frame, head to end, gathered for each copy of the chart it shows on. */
function chartPieces(state: GenerationState, stretches: readonly Stretch[]): Piece[][] {
  // hpc-exempt: one entry per chart copy a river shows on, seldom more than one.
  const copies = new Map<number, Piece[]>();
  for (const { geometry, profiles } of stretches)
    for (const copy of chartCopies(state.domain.world.reference, geometry) as LineString[]) {
      const pieces = piecesInFrame(state, copy, profiles);
      if (!pieces.length) continue;
      const shift = Math.round(copy.coordinates[0][0] - geometry.coordinates[0][0]);
      copies.set(shift, [...(copies.get(shift) ?? []), ...pieces]);
    }
  return [...copies.values()];
}
/** Where the stretches' channels meet others: the points a river's network is cut at. */
function junctionsOf(state: GenerationState, stretches: readonly Stretch[], paths: RiverPaths) {
  const [ox, oy] = state.physical!.map.mesh.origin;
  return stretches.flatMap(({ members }) =>
    members
      .filter((i) => (paths.incoming?.get(i) ?? 0) > 1)
      .map((i) => [paths.x.get(i) + ox, paths.y.get(i) + oy])
  );
}
/**
 * One river, drawn once: the stretches of its course inside the frame as one record, a single
 * line or one line for each stretch where the course leaves the frame and returns. The record
 * describes the whole course the map holds, from its head here to its end here. A course that
 * shows on more than one copy of the chart has a record on each.
 */
function publishCourse(
  state: GenerationState,
  parts: readonly number[][],
  paths: RiverPaths,
  basinDischarge: number
): { ids: string[]; key?: string } {
  const work = state.physical!,
    stretches = parts
      .filter((members) => members.length >= 2)
      .map((members) => drawStretch(state, members, paths)),
    ids: string[] = [];
  let first: string | undefined;
  if (!stretches.length) return { ids };
  const head = stretches[0].members[0],
    source = nativePosition(work, head),
    outlet = nativePosition(work, stretches.at(-1)!.members.at(-1)!),
    junctions = junctionsOf(state, stretches, paths);
  for (const pieces of chartPieces(state, stretches)) {
    const profiles = Object.fromEntries(
      Object.keys(pieces[0].profiles).map((key) => [
        key,
        pieces.flatMap((piece) => piece.profiles[key]),
      ])
    );
    const key = `river:${coordinateKey(source.x, source.y)}:${coordinateKey(outlet.x, outlet.y)}:${ids.length}`;
    first ??= key;
    const feature = generatedFeature(
      state,
      key,
      `River ${Math.round(MapScale.inUnits(source.x, "km"))} ${Math.round(MapScale.inUnits(source.y, "km"))}`,
      "river",
      "rivers",
      pieces.length === 1
        ? { type: "LineString", coordinates: pieces[0].coordinates }
        : { type: "MultiLineString", coordinates: pieces.map((piece) => piece.coordinates) },
      {
        order: reachAt(work.map, head)?.order ?? 0,
        junctions,
        discharge: profiles.discharges[0],
        regime: courseRegime(profiles.flowingMonths),
        basinDischarge,
        ...profiles,
        sourceAlgorithm: "atlas-1",
      }
    );
    putGeneratedNetwork(state, feature);
    ids.push(feature.id);
  }
  return { ids, key: first };
}
/**
 * What a river is through the year, by the greater part of its course: running all year,
 * running in its wet season only, or a named course that carries no river's flow now.
 */
export function courseRegime(flowingMonths: readonly number[] = []) {
  const months = flowingMonths.map(Math.round).sort((a, b) => a - b),
    middle = months[Math.floor(months.length / 2)] ?? 0;
  return middle >= 12 ? "perennial" : middle > 0 ? "seasonal" : "dry";
}
function riverWater(state: GenerationState) {
  const work = state.physical!,
    inChart = (geometry: Geometry) =>
      chartFootprint(geometry, state.surface.bounds, state.surface.periodicWidth);
  // hpc-exempt: one prepared outline per published lake, read while clipping river mouths.
  const lakes = new Map<number, Geometry>();
  for (const feature of generationFeatures(state, {
    kind: "lake",
    areaId: state.domain.scope.areaId,
  }))
    lakes.set(Number(feature.attributes.waterBody), inChart(feature.geometry));
  for (const [body, geometry] of work.lakeOutlines ?? []) lakes.set(body, inChart(geometry));
  return {
    ocean: state.surface.ocean ? inChart(state.surface.ocean) : null,
    lakes,
  };
}
/** A river's records say which river they draw, so what stands on it can follow it down. */
function nameItsRiver(state: GenerationState, ids: readonly string[], riverId: string) {
  for (const id of ids) {
    const feature = generationFeature(state, id);
    if (feature)
      writeGenerationFeature(state, {
        ...feature,
        attributes: { ...feature.attributes, riverId },
      });
  }
}
/** A course's cells inside the map's frame, as a line through their centres. */
function lineOf(state: GenerationState, cells: readonly number[]) {
  const work = state.physical!;
  return cells
    .filter((cell) => work.map.mesh.membership(cell) === 1)
    .map((cell) => {
      const p = nativePosition(work, cell);
      return [Math.round(p.x), Math.round(p.y)];
    });
}
/**
 * The dry reaches that were part of the river a named dry reach ends: those that ran into it,
 * and so on up, as far as another river's own named end.
 */
function dryCourseOf(end: Reach, dry: readonly Reach[]) {
  const course = [end];
  for (let n = 0; n < course.length; n++)
    for (const reach of dry)
      if (reach.downstream === course[n].id && !reach.river && !course.includes(reach))
        course.push(reach);
  return course;
}
/**
 * Rivers the map has drawn that have lost their water. Each is drawn again, dry, on the
 * course it had, as the same record it was drawn as when it ran: the same river, by the same
 * name, with no river in it.
 */
function publishDryRivers(state: GenerationState) {
  const dry = [...reachesOf(state.physical!.map)].filter((reach) => reach.dry);
  for (const end of dry) {
    if (!end.river || !end.record) continue;
    const lines = dryCourseOf(end, dry)
      .map((reach) => lineOf(state, reach.cells))
      .filter((line) => line.length >= 2);
    if (!lines.length) continue;
    const feature = generatedFeature(
      state,
      end.record,
      "Dry river",
      "river",
      "rivers",
      lines.length === 1
        ? { type: "LineString", coordinates: lines[0] }
        : { type: "MultiLineString", coordinates: lines },
      { order: end.order, regime: "dry", riverId: end.river, sourceAlgorithm: "atlas-1" }
    );
    putGenerated(state, feature);
  }
}
/**
 * The ground a drawn river has left: each course it used to take, long enough to be a course
 * at this map's scale, is drawn dry under the river's own name.
 */
function publishFormerCourses(
  state: GenerationState,
  reaches: readonly Reach[],
  drawnAs: string | undefined,
  riverId: string
) {
  const river = drawnAs ? generationFeature(state, drawnAs) : undefined,
    least = mapScale(state).resolveMeasure(worldRiverLength);
  if (!river) return;
  for (const reach of reaches)
    reach.former.forEach((course, n) => {
      const line = lineOf(state, course.cells);
      if (line.length < 2 || spatial.length({ type: "LineString", coordinates: line }) < least)
        return;
      const feature = generatedFeature(
        state,
        `river-former:${riverId}:${reach.id}:${n}`,
        river.name,
        "river",
        "rivers",
        { type: "LineString", coordinates: line },
        { order: reach.order, regime: "dry", former: true, riverId, sourceAlgorithm: "atlas-1" }
      );
      putGenerated(state, { ...feature, name: river.name });
    });
}
/** The map's rivers, drawn: each river once, as the course it holds inside the map's frame. */
export function publishRivers(state: GenerationState, context: MapProcessContext) {
  // Settled first: the working arrays below are the ones this reads with.
  riversOf(state);
  const work = state.physical!,
    map = work.map,
    paths = createRiverPaths(map),
    basinDischarge = basinDischarges(map);
  paths.water = riverWater(state);
  const records = keptReaches(state),
    reaches = records.map((record) => record.reach);
  try {
    // The map shows the rivers significant at its scale; the stored network keeps every reach
    // as latent drainage for finer maps. Every reach of a river points at the river's records.
    for (const { riverId, parts } of drawnRivers(state, records)) {
      const { ids, key } = publishCourse(
        state,
        parts.map((part) => part.flatMap((i, n) => records[i].members.slice(n ? 1 : 0))),
        paths,
        basinDischarge.get(reaches[parts[0][0]].basin)
      );
      nameItsRiver(state, ids, riverId);
      for (const i of parts.flat()) reaches[i].featureIds = ids;
      // The reach the river ends in keeps the record it was drawn as.
      const last = parts.at(-1)?.at(-1);
      if (last !== undefined && key) records[last].kept.record = key;
      publishFormerCourses(
        state,
        parts.flat().map((i) => records[i].kept),
        ids[0],
        riverId
      );
    }
  } finally {
    releaseWorking(map, basinDischarge);
    releaseWorking(map, paths.x, paths.y, paths.upstream);
    if (paths.incoming) releaseWorking(map, paths.incoming);
  }
  establishRivers(state, records);
  publishDryRivers(state);
  state.domain.world.drainage = {
    ...state.domain.world.drainage,
    [state.domain.scope.areaId]: {
      areaId: state.domain.scope.areaId,
      spaceId: state.domain.scope.spaceId,
      reaches,
    },
  };
  context.recordCause({
    kind: "domain",
    process: "atlas.geographic-extraction",
    subjects: [],
    description:
      "River reaches follow Canonry's water-budget lakes, capture drainage and Strahler network; raster channels retain crust, erosion, ice and landform history.",
  });
}

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
import { generatedFeature, putGeneratedNetwork } from "../mapFeatures";
import type { GenerationState, MapProcessContext } from "../process";
import { publishDryBeds } from "./dryBeds";
import {
  drainageReaches,
  drawnRivers,
  establishRivers,
  riverInputs,
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
): string[] {
  const work = state.physical!,
    stretches = parts
      .filter((members) => members.length >= 2)
      .map((members) => drawStretch(state, members, paths)),
    ids: string[] = [];
  if (!stretches.length) return ids;
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
    const feature = generatedFeature(
      state,
      `river:${coordinateKey(source.x, source.y)}:${coordinateKey(outlet.x, outlet.y)}:${ids.length}`,
      `River ${Math.round(MapScale.inUnits(source.x, "km"))} ${Math.round(MapScale.inUnits(source.y, "km"))}`,
      "river",
      "rivers",
      pieces.length === 1
        ? { type: "LineString", coordinates: pieces[0].coordinates }
        : { type: "MultiLineString", coordinates: pieces.map((piece) => piece.coordinates) },
      {
        order: work.map.RiverOrders.get(head),
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
  return ids;
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
/** The map's rivers, drawn: each river once, as the course it holds inside the map's frame. */
export function publishRivers(state: GenerationState, context: MapProcessContext) {
  // Settled first: the working arrays below are the ones this reads with.
  riversOf(state);
  const work = state.physical!,
    map = work.map,
    paths = createRiverPaths(map),
    { incoming, basinDischarge } = riverInputs(map);
  paths.water = riverWater(state);
  const records = [...drainageReaches(state, incoming)],
    reaches = records.map((record) => record.reach);
  try {
    // The map shows the rivers significant at its scale; the stored network keeps every reach
    // as latent drainage for finer maps. Every reach of a river points at the river's records.
    for (const { riverId, parts } of drawnRivers(state, records)) {
      const ids = publishCourse(
        state,
        parts.map((part) => part.flatMap((i, n) => records[i].members.slice(n ? 1 : 0))),
        paths,
        basinDischarge.get(reaches[parts[0][0]].basin)
      );
      nameItsRiver(state, ids, riverId);
      for (const i of parts.flat()) reaches[i].featureIds = ids;
    }
  } finally {
    releaseWorking(map, incoming, basinDischarge);
    releaseWorking(map, paths.x, paths.y, paths.upstream);
    if (paths.incoming) releaseWorking(map, paths.incoming);
  }
  establishRivers(state, reaches);
  publishDryBeds(state);
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

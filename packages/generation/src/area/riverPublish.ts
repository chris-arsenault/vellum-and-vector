import { chartCopies, chartFootprint, interpolateProfile, MapScale, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
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
import { isWorldGeography } from "../worldSignificance";
import {
  drainageReaches,
  establishRivers,
  mappedCourses,
  reachInFrame,
  riverIdOf,
  riverInputs,
  riverPositionAt,
  riversOf,
} from "./riverCourses";

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lineParts);
  return [];
}
function publishReach(
  state: GenerationState,
  start: number,
  members: number[],
  paths: RiverPaths,
  basinDischarge: number
): string[] {
  if (members.length < 2) return [];
  const work = state.physical!,
    map = work.map,
    ids: string[] = [];
  const valley = riverPath(map, paths, members),
    // A reach on a floodplain migrates across it; elsewhere it keeps the valley line.
    meandered = meanderReach(map, paths, valley.geometry, valley.profiles, start),
    geometry = meandered?.geometry ?? valley.geometry,
    profiles = (meandered?.profiles ?? valley.profiles) as typeof valley.profiles;
  for (const copy of chartCopies(state.domain.world.reference, geometry)) {
    ids.push(
      ...publishReachCopy(
        state,
        start,
        members,
        copy as typeof geometry,
        profiles,
        basinDischarge,
        ids.length,
        members
          .filter((i) => (paths.incoming?.get(i) ?? 0) > 1)
          .map((i) => [paths.x.get(i) + map.mesh.origin[0], paths.y.get(i) + map.mesh.origin[1]])
      )
    );
  }
  return ids;
}
function publishReachCopy(
  state: GenerationState,
  start: number,
  members: number[],
  geometry: ReturnType<typeof riverPath>["geometry"],
  profiles: ReturnType<typeof riverPath>["profiles"],
  basinDischarge: number,
  offset: number,
  junctions: number[][]
) {
  const work = state.physical!,
    map = work.map,
    footprint = state.domain.scope.footprint,
    ids: string[] = [];
  if (!spatial.intersects(geometry, footprint)) return ids;
  const area = state.domain.world.areas[state.domain.scope.areaId];
  if (area.boundary && spatial.crossings(geometry, footprint).length) return ids;
  const clipped = spatial.covers(footprint, geometry)
    ? geometry
    : spatial.intersection(geometry, footprint);
  if (!clipped) return ids;
  for (const [part, coordinates] of lineParts(clipped).entries()) {
    if (coordinates.length < 2) continue;
    const reach = { type: "LineString" as const, coordinates };
    const source = nativePosition(work, start),
      outlet = nativePosition(work, members.at(-1)!);
    const attributes =
      clipped === geometry
        ? profiles
        : Object.fromEntries(
            Object.keys(profiles).map((key) => [
              key,
              interpolateProfile(geometry, profiles, reach, key)!,
            ])
          );
    const discharges = attributes.discharges;
    const feature = generatedFeature(
      state,
      `river:${coordinateKey(source.x, source.y)}:${coordinateKey(outlet.x, outlet.y)}:${part + offset}`,
      `River ${Math.round(MapScale.inUnits(source.x, "km"))} ${Math.round(MapScale.inUnits(source.y, "km"))}`,
      "river",
      "rivers",
      reach,
      {
        order: map.RiverOrders.get(start),
        junctions,
        discharge: discharges[0],
        basinDischarge,
        ...attributes,
        sourceAlgorithm: "atlas-1",
      }
    );
    putGeneratedNetwork(state, feature);
    ids.push(feature.id);
  }
  return ids;
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
/** The map's rivers, drawn: a World's whole courses, a finer map's reach by reach in its frame. */
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
  function* publish() {
    // The map shows the rivers significant at its scale; the stored network keeps every reach
    // as latent drainage for finer maps.
    const courses = mappedCourses(state, reaches);
    if (isWorldGeography(state)) {
      for (const course of courses) {
        const members = course.flatMap((i, n) => records[i].members.slice(n ? 1 : 0)),
          first = records[course[0]],
          ids = publishReach(
            state,
            first.start,
            members,
            paths,
            basinDischarge.get(first.reach.basin)
          );
        nameItsRiver(state, ids, riverIdOf(course.map((i) => reaches[i])));
        for (const i of course) reaches[i].featureIds = ids;
        yield { members, featureIds: ids };
      }
      return;
    }
    // A finer map publishes its rivers reach by reach, inside its footprint.
    for (const { start, members, reach } of records) {
      const riverId = members
        .slice(0, -1)
        .map((cell) => riverPositionAt(state, cell)?.riverId)
        .find(Boolean);
      if (!riverId) continue;
      const discharge = basinDischarge.get(reach.basin);
      if (!reachInFrame(state, start)) continue;
      reach.featureIds = publishReach(state, start, members, paths, discharge);
      nameItsRiver(state, reach.featureIds, riverId);
      yield { members, featureIds: reach.featureIds };
    }
  }
  try {
    for (const reach of publish()) void reach;
  } finally {
    releaseWorking(map, incoming, basinDischarge);
    releaseWorking(map, paths.x, paths.y, paths.upstream);
    if (paths.incoming) releaseWorking(map, paths.incoming);
  }
  establishRivers(state, reaches);
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

import { chartCopies, interpolateProfile, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState, MapProcessContext } from "../process";
import { generatedFeature, putGeneratedNetwork } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { extractFaults } from "./geologicalFeatures";
import { extractLakes } from "./geographicRegions";
import { publishKinds } from "../poi/poiPublish";
import type { PoiEntry } from "../poi/poiContract";
import { createRiverPaths, riverPath, type RiverPaths } from "./riverPaths";
import { meanderReach } from "./riverMeanders";
import { oceanFootprint } from "./geographicContours";
import { extractRanges } from "./reliefFeatures";
import { extractOceans } from "./oceanFeatures";
import { dropClaimedFeatures, extractLandmarks, landmarkClaims } from "./landmarkFeatures";
import { releaseWorking } from "./physicalNumerics";
import { generationFeature, generationFeatures } from "../generationFeatures";
import { isWorldGeography } from "../worldSignificance";
import { drainageReaches, mappedCourses, reachInFrame, riverInputs } from "./mappedRivers";

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
      `River ${Math.round(source.x / 1000)} ${Math.round(source.y / 1000)}`,
      "river",
      "rivers",
      reach,
      {
        order: map.RiverOrders.get(start),
        junctions,
        discharge: discharges[0],
        basinDischarge,
        ...attributes,
        sourceAlgorithm: "canonry-0f62584c",
      }
    );
    putGeneratedNetwork(state, feature);
    ids.push(feature.id);
  }
  return ids;
}
export interface GeographicDeliveries {
  oceans: boolean;
  impacts: boolean;
  volcanism: boolean;
  fractures: boolean;
  lakes: boolean;
  landforms: boolean;
  ecology: boolean;
  rivers: boolean;
  landmarks: boolean;
}
const allDeliveries: GeographicDeliveries = {
  oceans: true,
  impacts: true,
  volcanism: true,
  fractures: true,
  lakes: true,
  landforms: true,
  ecology: true,
  rivers: true,
  landmarks: true,
};
/** Whether the run's selected features deliver what a kind's places are read from. */
function delivered(entry: PoiEntry, deliveries: GeographicDeliveries) {
  if (entry.group === "cover" || entry.id === "wetland") return deliveries.ecology;
  if (entry.id === "lake") return deliveries.lakes;
  if (entry.id === "volcano" || entry.id === "caldera") return deliveries.volcanism;
  return deliveries.landforms;
}
export function extractNativeGeography(
  state: GenerationState,
  context: MapProcessContext,
  deliveries = allDeliveries
) {
  context.progress(0, "Tracing ocean shoreline");
  state.surface.ocean = oceanFootprint(state);
  context.progress(0.1, "Extracting ocean regions");
  if (deliveries.oceans) extractOceans(state);
  context.progress(0.2, "Extracting geological events and lakes");
  if (deliveries.fractures) extractFaults(state);
  if (deliveries.lakes) extractLakes(state);
  context.progress(0.35, "Extracting landforms");
  if (deliveries.landforms) extractRanges(state);
  context.progress(0.5, "Publishing the map's places");
  publishKinds(state, "geography", (entry) => delivered(entry, deliveries));
  context.progress(0.8, "Extracting river geography");
  if (deliveries.rivers) extractRiverGeography(state, context);
  else delete state.domain.world.drainage?.[state.domain.scope.areaId];
  // Last: a detected landform on a landmark is the landmark, published once under its identity.
  if (deliveries.landmarks) {
    dropClaimedFeatures(state, landmarkClaims(state));
    extractLandmarks(state);
  }
  context.progress(1, "Geographic extraction complete");
}
function riverWater(state: GenerationState) {
  const work = state.physical!;
  // hpc-exempt: one feature id per published lake, read while clipping river mouths.
  const lakes = new Map<number, string>();
  for (const feature of generationFeatures(state, {
    kind: "lake",
    areaId: state.domain.scope.areaId,
  }))
    lakes.set(Number(feature.attributes.waterBody), feature.id);
  return {
    ocean: state.surface.ocean ?? null,
    lakes: {
      get(id: number) {
        const physical = work.lakeOutlines?.get(id);
        if (physical) return physical;
        const featureId = lakes.get(id);
        return featureId ? generationFeature(state, featureId)?.geometry : undefined;
      },
    },
  };
}
function extractRiverGeography(state: GenerationState, context: MapProcessContext) {
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
        for (const i of course) reaches[i].featureIds = ids;
        yield { members, featureIds: ids };
      }
      return;
    }
    // A finer map publishes the significant courses reach by reach, inside its footprint.
    const significant = new Set(courses.flat());
    for (const [index, { start, members, reach }] of records.entries()) {
      if (!significant.has(index)) continue;
      const discharge = basinDischarge.get(reach.basin);
      if (!reachInFrame(state, start)) continue;
      reach.featureIds = publishReach(state, start, members, paths, discharge);
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
    process: "canonry.geographic-extraction",
    subjects: [],
    description:
      "River reaches follow Canonry's water-budget lakes, capture drainage and Strahler network; raster channels retain crust, erosion, ice and landform history.",
  });
}

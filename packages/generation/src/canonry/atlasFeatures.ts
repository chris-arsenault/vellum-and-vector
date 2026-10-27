import {
  chartCopies,
  unwrapCoordinates,
  interpolateProfile,
  point,
  spatial,
  type DrainageReach,
  type NumericalVector,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState, MapProcessContext } from "../process";
import { generatedFeature, putGeneratedNetwork } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { extractGeologicalEvents } from "./geologicalFeatures";
import { extractLakes, extractNamedLandforms, extractMagicPlaces } from "./geographicRegions";
import { createRiverPaths, riverPath, type RiverPaths } from "./riverPaths";
import type { PhysicalField } from "./field";
import { oceanFootprint } from "./geographicContours";
import { extractEcologicalFeatures } from "./ecologyFeatures";
import { extractReliefFeatures, extractValleys } from "./reliefFeatures";
import { physicalDistance } from "./physicalMetric";
import { extractOceans } from "./oceanFeatures";
import { dropClaimedFeatures, extractLandmarks, landmarkClaims } from "./landmarkFeatures";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { generationFeature, generationFeatures } from "../generationFeatures";

function riverReach(state: GenerationState, start: number, incoming: NumericalVector) {
  const map = state.physical!.map,
    members = [start];
  let i = start;
  while (map.FlowTargets[i] >= 0) {
    const j = map.FlowTargets[i];
    members.push(j);
    if (map.WaterKindCodes[j] !== 0 || map.RiverOrders[j] <= 0 || incoming[j] !== 1) break;
    i = j;
  }
  return members;
}

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
  const { geometry, profiles } = riverPath(map, paths, members);
  for (const copy of chartCopies(state.domain.world.reference, geometry)) {
    ids.push(
      ...publishReachCopy(
        state,
        start,
        members,
        copy as typeof geometry,
        profiles,
        basinDischarge,
        ids.length
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
  offset: number
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
        order: map.RiverOrders[start],
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
/** Every reach as extraction forms it, linked downstream through the cell it ends on. */
function* drainageReaches(
  state: GenerationState,
  incoming: NumericalVector
): IterableIterator<{ start: number; members: number[]; reach: DrainageReach }> {
  const work = state.physical!,
    map = work.map,
    starts = workingArray(map, "int32", "rivers:reach-starts").fill(-1);
  let count = 0;
  for (let i = 0; i < map.mesh.contentCount; i++)
    if (map.RiverOrders[i] > 0 && incoming[i] !== 1) starts[i] = count++;
  try {
    for (let i = 0; i < map.mesh.contentCount; i++) {
      if (starts[i] < 0) continue;
      const members = riverReach(state, i, incoming),
        mouth = members.at(-1)!;
      yield {
        start: i,
        members,
        reach: {
          downstream: members.length > 1 && starts[mouth] >= 0 ? starts[mouth] : null,
          waterBody: map.WaterKindCodes[mouth] !== 0 ? map.WaterBodyIds[mouth] : null,
          order: map.RiverOrders[i],
          basin: map.DrainageBasinIds[i],
          coordinates: unwrapCoordinates(
            members.map((j) => {
              const p = nativePosition(work, j);
              return [Math.round(p.x), Math.round(p.y)] as [number, number];
            }),
            map.mesh.periodic?.width
          ) as [number, number][],
          discharges: members.map((j) => map.FlowAccumulation[j]),
          catchmentAreas: members.map((j) => map.CatchmentArea[j]),
          featureIds: [],
        } satisfies DrainageReach,
      };
    }
  } finally {
    releaseWorking(map, starts);
  }
}
/** World maps keep their major basins; a dry world still shows its largest river systems. */
function worldRiverMinimum(state: GenerationState, basinDischarge: Map<number, number>) {
  if (state.domain.world.areas[state.domain.scope.areaId].profile !== "world") return 0;
  let largest = 0;
  for (const discharge of basinDischarge.values()) largest = Math.max(largest, discharge);
  return Math.min(state.physical!.profile.WorldRiverMinimumBasinDischarge, largest / 2);
}
/**
 * A short first-order tributary draws one lattice step of valley side as a parallel tooth.
 * The physical channel remains for erosion and landforms; only the map omits it. A short
 * river reaching the sea or a lake is a complete river and stays.
 */
function shortHeadwater(
  work: NonNullable<GenerationState["physical"]>,
  incoming: NumericalVector,
  members: number[]
) {
  const mouth = members.at(-1)!;
  if (incoming[members[0]] !== 0 || work.map.WaterKindCodes[mouth] !== 0) return false;
  let length = 0;
  for (let n = 1; n < members.length; n++)
    length += physicalDistance(work.map.mesh, members[n - 1], members[n]);
  return length < work.profile.MappedHeadwaterMinimumLength;
}
function riverInputs(map: PhysicalField) {
  const incoming = workingArray(map, "int32", "rivers:incoming"),
    basinDischarge = new Map<number, number>();
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds[i];
    basinDischarge.set(basin, Math.max(basinDischarge.get(basin) ?? 0, map.FlowAccumulation[i]));
    const j = map.FlowTargets[i];
    if (map.RiverOrders[i] > 0 && j >= 0 && map.RiverOrders[j] > 0) incoming[j]++;
  }
  return { incoming, basinDischarge };
}
export interface GeographicDeliveries {
  oceans: boolean;
  impacts: boolean;
  volcanism: boolean;
  fractures: boolean;
  lakes: boolean;
  landforms: boolean;
  magic: boolean;
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
  magic: true,
  ecology: true,
  rivers: true,
  landmarks: true,
};
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
  extractGeologicalEvents(state, deliveries);
  if (deliveries.lakes) extractLakes(state);
  context.progress(0.35, "Extracting landforms");
  if (deliveries.landforms) {
    extractNamedLandforms(state);
    extractReliefFeatures(state);
  }
  context.progress(0.5, "Extracting magical places");
  if (deliveries.magic) extractMagicPlaces(state);
  context.progress(0.65, "Extracting ecological regions");
  if (deliveries.ecology) extractEcologicalFeatures(state);
  context.progress(0.8, "Extracting river geography");
  if (deliveries.rivers) extractRiverGeography(state, context, deliveries.landforms);
  else delete state.domain.world.drainage?.[state.domain.scope.areaId];
  // Last: a detected landform on a landmark is the landmark, published once under its identity.
  if (deliveries.landmarks) {
    dropClaimedFeatures(state, landmarkClaims(state));
    extractLandmarks(state);
  }
  context.progress(1, "Geographic extraction complete");
}
function extractRiverGeography(
  state: GenerationState,
  context: MapProcessContext,
  valleys: boolean
) {
  const work = state.physical!,
    map = work.map,
    paths = createRiverPaths(map),
    { incoming, basinDischarge } = riverInputs(map);
  const lakes = new Map<number, string>();
  for (const feature of generationFeatures(state, {
    kind: "lake",
    areaId: state.domain.scope.areaId,
  }))
    lakes.set(Number(feature.attributes.waterBody), feature.id);
  paths.water = {
    ocean: state.surface.ocean ?? null,
    lakes: {
      get(id) {
        const featureId = lakes.get(id);
        return featureId ? generationFeature(state, featureId)?.geometry : undefined;
      },
    },
  };
  const minimum = worldRiverMinimum(state, basinDischarge),
    reaches: DrainageReach[] = [];
  function* publish() {
    // The map shows a subset; the stored network keeps every reach for finer areas.
    for (const { start, members, reach } of drainageReaches(state, incoming)) {
      reaches.push(reach);
      const discharge = basinDischarge.get(reach.basin) ?? 0;
      if (discharge < minimum) continue;
      if (!spatial.covers(state.domain.scope.footprint, point(nativePosition(work, start))))
        continue;
      if (shortHeadwater(work, incoming, members)) continue;
      reach.featureIds = publishReach(state, start, members, paths, discharge);
      yield { members, featureIds: reach.featureIds };
    }
  }
  try {
    if (valleys) extractValleys(state, publish());
    else for (const reach of publish()) void reach;
  } finally {
    releaseWorking(map, incoming);
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

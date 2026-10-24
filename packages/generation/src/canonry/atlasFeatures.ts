import {
  chartCopies,
  unwrapCoordinates,
  interpolateProfile,
  point,
  spatial,
  type DrainageReach,
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

function riverReach(state: GenerationState, start: number, incoming: Int32Array) {
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
function drainageReaches(state: GenerationState, incoming: Int32Array) {
  const work = state.physical!,
    map = work.map,
    reaches: { start: number; members: number[]; reach: DrainageReach }[] = [];
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.RiverOrders[i] <= 0 || incoming[i] === 1) continue;
    const members = riverReach(state, i, incoming),
      mouth = members.at(-1)!;
    reaches.push({
      start: i,
      members,
      reach: {
        downstream: null,
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
      },
    });
  }
  const starts = new Map(reaches.map(({ start }, index) => [start, index]));
  for (const { members, reach } of reaches)
    reach.downstream = members.length > 1 ? (starts.get(members.at(-1)!) ?? null) : null;
  return reaches;
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
  incoming: Int32Array,
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
  const incoming = new Int32Array(map.mesh.count),
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
};
export function extractNativeGeography(
  state: GenerationState,
  context: MapProcessContext,
  deliveries = allDeliveries
) {
  state.surface.ocean = oceanFootprint(state);
  if (deliveries.oceans) extractOceans(state);
  extractGeologicalEvents(state, deliveries);
  if (deliveries.lakes) extractLakes(state);
  if (deliveries.landforms) {
    extractNamedLandforms(state);
    extractReliefFeatures(state);
  }
  if (deliveries.magic) extractMagicPlaces(state);
  if (deliveries.ecology) extractEcologicalFeatures(state);
  if (deliveries.rivers) extractRiverGeography(state, context, deliveries.landforms);
  else delete state.domain.world.drainage?.[state.domain.scope.areaId];
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
  paths.water = {
    ocean: state.surface.ocean ?? null,
    lakes: new Map(
      Object.values(state.domain.world.features)
        .filter(
          (feature) => feature.kind === "lake" && feature.areaId === state.domain.scope.areaId
        )
        .map((feature) => [Number(feature.attributes.waterBody), feature.geometry])
    ),
  };
  const minimum = worldRiverMinimum(state, basinDischarge),
    reaches = drainageReaches(state, incoming);
  // The map shows a subset; the stored network keeps every reach for finer areas.
  for (const { start, members, reach } of reaches) {
    const discharge = basinDischarge.get(reach.basin) ?? 0;
    if (discharge < minimum) continue;
    if (!spatial.covers(state.domain.scope.footprint, point(nativePosition(work, start)))) continue;
    if (shortHeadwater(work, incoming, members)) continue;
    reach.featureIds = publishReach(state, start, members, paths, discharge);
  }
  if (valleys)
    extractValleys(
      state,
      reaches.map(({ members, reach }) => ({ members, featureIds: reach.featureIds }))
    );
  state.domain.world.drainage = {
    ...state.domain.world.drainage,
    [state.domain.scope.areaId]: {
      areaId: state.domain.scope.areaId,
      spaceId: state.domain.scope.spaceId,
      reaches: reaches.map(({ reach }) => reach),
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

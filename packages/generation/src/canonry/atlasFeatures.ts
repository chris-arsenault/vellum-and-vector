import { interpolateProfile, point, spatial } from "@atlas/domain";
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
import { physicalDistance } from "./physicalMetric";

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
) {
  if (members.length < 2) return;
  const work = state.physical!,
    map = work.map,
    footprint = state.domain.scope.footprint;
  const { geometry, profiles } = riverPath(map, paths, members);
  if (!spatial.intersects(geometry, footprint)) return;
  const area = state.domain.world.areas[state.domain.scope.areaId];
  if (area.boundary && spatial.crossings(geometry, footprint).length) return;
  const clipped = spatial.covers(footprint, geometry)
    ? geometry
    : spatial.intersection(geometry, footprint);
  if (!clipped) return;
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
      `river:${coordinateKey(source.x, source.y)}:${coordinateKey(outlet.x, outlet.y)}:${part}`,
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
  extractGeologicalEvents(state, deliveries);
  if (deliveries.lakes) extractLakes(state);
  if (deliveries.landforms) extractNamedLandforms(state);
  if (deliveries.magic) extractMagicPlaces(state);
  if (deliveries.ecology) extractEcologicalFeatures(state);
  if (!deliveries.rivers) return;
  extractRiverGeography(state, context);
}
function extractRiverGeography(state: GenerationState, context: MapProcessContext) {
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
  const minimum = worldRiverMinimum(state, basinDischarge);
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.RiverOrders[i] <= 0 || incoming[i] === 1) continue;
    const discharge = basinDischarge.get(map.DrainageBasinIds[i]) ?? 0;
    if (discharge < minimum) continue;
    const p = nativePosition(work, i);
    if (!spatial.covers(state.domain.scope.footprint, point(p))) continue;
    const members = riverReach(state, i, incoming);
    if (shortHeadwater(work, incoming, members)) continue;
    publishReach(state, i, members, paths, discharge);
  }
  context.recordCause({
    kind: "domain",
    process: "canonry.geographic-extraction",
    subjects: [],
    description:
      "River reaches follow Canonry's water-budget lakes, capture drainage and Strahler network; raster channels retain crust, erosion, ice and landform history.",
  });
}

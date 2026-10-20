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
import { publishMacroFeatures } from "./macroPublication";

function riverReach(
  state: GenerationState,
  start: number,
  incoming: Int32Array,
  paths: RiverPaths
) {
  const composed = paths.reaches?.get(start)?.members;
  if (composed) return composed;
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
export function extractNativeGeography(state: GenerationState, context: MapProcessContext) {
  setOcean(state);
  context.progress(0.05, "Publishing geological structures and water bodies");
  extractGeologicalEvents(state);
  context.progress(0.1, "Publishing lakes");
  extractLakes(state);
  context.progress(0.15, "Publishing named landforms");
  extractNamedLandforms(state);
  context.progress(0.22, "Publishing composed passes, summits and gorges");
  publishMacroFeatures(state);
  context.progress(0.3, "Publishing magical regions");
  extractMagicPlaces(state);
  context.progress(0.55, "Publishing ecological regions");
  extractEcologicalFeatures(state);
  context.progress(0.75, "Publishing connected river reaches");
  const work = state.physical!,
    map = work.map,
    paths = geographyRiverPaths(state),
    { incoming, basinDischarge } = riverInputs(map);
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.RiverOrders[i] <= 0 || incoming[i] === 1) continue;
    const discharge = basinDischarge.get(map.DrainageBasinIds[i]) ?? 0;
    if (
      state.domain.world.areas[state.domain.scope.areaId].profile === "world" &&
      discharge < work.profile.WorldRiverMinimumBasinDischarge
    )
      continue;
    const p = nativePosition(work, i);
    if (!spatial.covers(state.domain.scope.footprint, point(p))) continue;
    publishReach(state, i, riverReach(state, i, incoming, paths), paths, discharge);
  }
  context.recordCause({
    kind: "domain",
    process: "canonry.geographic-extraction",
    subjects: [],
    description:
      "River reaches follow Canonry's water-budget lakes, capture drainage and Strahler network; raster channels retain crust, erosion, ice and landform history.",
  });
}
function geographyRiverPaths(state: GenerationState) {
  const work = state.physical!,
    paths = work.finishing?.rivers ?? createRiverPaths(work.map);
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
  return paths;
}
function setOcean(state: GenerationState) {
  state.surface.ocean = state.physical!.finishing?.ocean ?? oceanFootprint(state);
}

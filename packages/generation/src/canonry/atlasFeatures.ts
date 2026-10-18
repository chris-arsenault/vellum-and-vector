import { interpolateProfile, point, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState, MapProcessContext } from "../process";
import { generatedFeature, putGeneratedNetwork } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { dischargeScale } from "./atlasProjection";
import { triangleIdentity } from "./mesh";
import { extractLakes, extractNamedLandforms, extractMagicPlaces } from "./geographicRegions";

function riverReach(state: GenerationState, start: number, incoming: Int32Array) {
  const work = state.physical!,
    map = work.map,
    members = [start];
  let i = start;
  while (map.FlowTargets[i] >= 0) {
    const target = map.FlowTargets[i];
    members.push(target);
    if (map.WaterKindCodes[target] === 1 || map.RiverOrders[target] <= 0 || incoming[target] !== 1)
      break;
    i = target;
  }
  return members;
}
function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lineParts);
  return [];
}
function publishReach(state: GenerationState, start: number, members: number[]) {
  const work = state.physical!,
    map = work.map,
    footprint = state.domain.scope.footprint;
  const coordinates = members.map((i) => {
    const p = nativePosition(work, i);
    return [p.x, p.y];
  });
  const geometry = { type: "LineString" as const, coordinates };
  if (!spatial.intersects(geometry, footprint)) return;
  const area = state.domain.world.areas[state.domain.scope.areaId];
  if (area.boundary && spatial.crossings(geometry, footprint).length) return;
  const clipped = spatial.intersection(geometry, footprint);
  if (!clipped) return;
  const factor = dischargeScale(state),
    profiles = {
      discharges: members.map((i) => map.FlowAccumulation[i] * factor),
      elevations: members.map((i) => (map.DrainageElevations[i] - map.BaseSeaLevel) / 1024),
    };
  for (const [part, coordinates] of lineParts(clipped).entries()) {
    if (coordinates.length < 2) continue;
    const reach = { type: "LineString" as const, coordinates };
    const feature = generatedFeature(
      state,
      `river:${triangleIdentity(map.mesh, start)}:${part}`,
      `River ${Math.abs(triangleIdentity(map.mesh, start))}`,
      "river",
      "rivers",
      reach,
      {
        order: map.RiverOrders[start],
        discharge: map.FlowAccumulation[start] * factor,
        discharges: interpolateProfile(geometry, profiles, reach, "discharges"),
        elevations: interpolateProfile(geometry, profiles, reach, "elevations"),
        sourceAlgorithm: "canonry-0f62584c",
      }
    );
    putGeneratedNetwork(state, feature);
  }
}
export function extractNativeGeography(state: GenerationState, context: MapProcessContext) {
  extractLakes(state);
  extractNamedLandforms(state);
  extractMagicPlaces(state);
  const work = state.physical!,
    map = work.map,
    incoming = new Int32Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets[i];
    if (map.RiverOrders[i] > 0 && target >= 0 && map.RiverOrders[target] > 0) incoming[target]++;
  }
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.RiverOrders[i] <= 0 || incoming[i] === 1) continue;
    const p = nativePosition(work, i);
    if (!spatial.covers(state.domain.scope.footprint, point(p))) continue;
    publishReach(state, i, riverReach(state, i, incoming));
  }
  context.recordCause({
    kind: "domain",
    process: "canonry.geographic-extraction",
    subjects: [],
    description:
      "River reaches follow Canonry's water-budget lakes, capture drainage and Strahler network; raster channels retain crust, erosion, ice and landform history.",
  });
}

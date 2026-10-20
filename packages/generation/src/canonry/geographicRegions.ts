import { spatial, point } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { Landform } from "./codes";
import { lakeFootprint, membershipContour } from "./geographicContours";

export function extractLakes(state: GenerationState) {
  const map = state.physical!.map,
    mesh = map.mesh;
  const bodies = new Map<number, number[]>();
  // A visible lake can continue into the numerical halo. Trace its complete
  // basin before clipping; truncating its support leaves an open shoreline.
  for (let i = 0; i < mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 2) continue;
    const body = map.WaterBodyIds[i];
    if (!bodies.has(body)) bodies.set(body, []);
    bodies.get(body)!.push(i);
  }
  for (const [body, members] of bodies) {
    if (!members.some((i) => i < mesh.contentCount)) continue;
    const level = map.WaterSurfaceElevations[members[0]];
    const contour =
      state.physical!.finishing?.lakes.get(body)?.footprint ??
      lakeFootprint(state, members, body, level);
    const shape = clipRegion(state, contour);
    if (!shape) continue;
    putGenerated(
      state,
      generatedFeature(
        state,
        `lake:${spatial
          .bounds(shape)
          .map((value) => value.toFixed(3))
          .join(":")}`,
        `Lake ${body}`,
        "lake",
        "lakes",
        shape,
        {
          sourceAlgorithm: "canonry-0f62584c",
          waterBody: body,
          waterLevel: (level - map.BaseSeaLevel) / 1024,
          area: spatial.area(shape),
        }
      )
    );
  }
}
function clipRegion(state: GenerationState, shape: Geometry | null) {
  return shape && spatial.intersection(shape, state.domain.scope.footprint);
}
function connectedMembers(
  state: GenerationState,
  visited: Int32Array,
  includes: (i: number) => boolean,
  start: number,
  region: number
) {
  const members = [start],
    mesh = state.physical!.map.mesh;
  visited[start] = region;
  for (let head = 0; head < members.length; head++)
    for (let edge = 0; edge < mesh.degree[members[head]]; edge++) {
      const j = mesh.neighbors[members[head] * mesh.stride + edge];
      if (j < 0 || j >= visited.length || visited[j] >= 0 || !includes(j)) continue;
      visited[j] = region;
      members.push(j);
    }
  return members;
}
export function components(
  state: GenerationState,
  includes: (i: number) => boolean,
  publish: (members: number[], geometry?: Geometry) => void,
  polygonal = false
) {
  const map = state.physical!.map,
    visited = new Int32Array(map.mesh.contentCount).fill(-1),
    regions: number[][] = [];
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] >= 0 || !includes(i)) continue;
    regions.push(connectedMembers(state, visited, includes, i, regions.length));
  }
  const shapes = polygonal ? regionShapes(state, visited) : new Map<number, Geometry>();
  regions.forEach((members, i) => publish(members, shapes.get(i)));
}
function regionShapes(state: GenerationState, labels: Int32Array) {
  const members = new Map<number, number[]>();
  labels.forEach((label, cell) => {
    if (label < 0) return;
    if (!members.has(label)) members.set(label, []);
    members.get(label)!.push(cell);
  });
  const result = new Map<number, Geometry>();
  for (const [label, leaves] of members) {
    const shape = clipRegion(
      state,
      membershipContour(state, leaves, (cell) => Number(labels[cell] === label))
    );
    if (shape) result.set(label, shape);
  }
  return result;
}
export function publishPlace(
  state: GenerationState,
  kind: string,
  name: string,
  members: number[],
  layer: string,
  attributes: Record<string, unknown> = {},
  extent?: Geometry
) {
  const work = state.physical!,
    map = work.map;
  const covers = spatial.pointCoverage(state.domain.scope.footprint);
  let representative = -1;
  for (const i of members) {
    if (!covers(nativePosition(work, i))) continue;
    if (representative < 0 || map.Elevation[i] > map.Elevation[representative]) representative = i;
  }
  if (representative < 0) return;
  const position = nativePosition(work, representative),
    geometry = extent ?? point(position);
  const identity = coordinateKey(position.x, position.y);
  putGenerated(
    state,
    generatedFeature(
      state,
      `${kind}:${identity}`,
      `${name} ${Math.round(position.x / 1000)} ${Math.round(position.y / 1000)}`,
      kind,
      layer,
      geometry,
      {
        sourceAlgorithm: "canonry-0f62584c",
        area: extent
          ? spatial.area(extent)
          : members.reduce((sum, i) => sum + map.mesh.areas[i], 0),
        representative: position,
        elevation: (map.Elevation[representative] - map.BaseSeaLevel) / 1024,
        ...attributes,
      }
    )
  );
}
export function extractNamedLandforms(state: GenerationState) {
  const map = state.physical!.map;
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: Geometry) => shape;
  const classes: [string, string, (i: number) => boolean][] = [
    ["peak", "Peak", (i) => map.LandformCodes[i] === Landform.Peak],
    ["cirque", "Cirque", (i) => map.LandformCodes[i] === Landform.Cirque],
    ["fjord", "Fjord", (i) => map.LandformCodes[i] === Landform.Fjord],
    ["moraine", "Moraine", (i) => map.LandformCodes[i] === Landform.Moraine],
    ["waterfall", "Waterfall", (i) => map.LandformCodes[i] === Landform.Waterfall],
    ["gorge", "Gorge", (i) => map.LandformCodes[i] === Landform.Gorge],
  ];
  for (const [kind, name, includes] of classes)
    if (!(state.physical!.finishing && ["waterfall", "gorge"].includes(kind)))
      components(
        state,
        includes,
        (members, extent) => {
          const surface = extent && kind !== "fjord" ? dry(extent) : extent;
          if (extent && !surface) return;
          publishPlace(state, kind, name, members, "geology", {}, surface ?? undefined);
        },
        !["peak", "waterfall"].includes(kind)
      );
}
export function extractMagicPlaces(state: GenerationState) {
  const magic = state.physical!.magic;
  for (const field of magic?.fields ?? [])
    for (const rule of field.definition.features) {
      const members = field.features[rule.id];
      if (!members) continue;
      components(
        state,
        (i) => Boolean(members[i]),
        (region, extent) =>
          publishPlace(
            state,
            `${field.definition.id}:${rule.id}`,
            rule.name,
            region,
            "magic",
            {
              system: field.definition.id,
              rule: rule.id,
              maximumIntensity: region.reduce((peak, i) => Math.max(peak, field.intensity[i]), 0),
              accumulatedActivity:
                region.reduce(
                  (sum, i) => sum + field.history[i] * state.physical!.map.mesh.areas[i],
                  0
                ) / region.reduce((sum, i) => sum + state.physical!.map.mesh.areas[i], 0),
            },
            extent
          ),
        true
      );
    }
}

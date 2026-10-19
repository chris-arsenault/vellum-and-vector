import { spatial, point } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { cellPolygon, generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { Landform } from "./codes";

export function extractLakes(state: GenerationState) {
  const grid = state.surface,
    work = state.physical!,
    map = work.map;
  const shapes = new Map<number, Geometry[]>();
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x,
        native = work.samples[i];
      if (!grid.active[i] || map.WaterKindCodes[native] !== 2) continue;
      const body = map.WaterBodyIds[native],
        start = x;
      while (x + 1 < grid.width && lakeBody(state, y * grid.width + x + 1) === body) x++;
      if (!shapes.has(body)) shapes.set(body, []);
      shapes.get(body)!.push(cellPolygon(grid, start, x, y));
    }
  for (const [body, parts] of shapes) {
    const shape = lakeShape(state, parts);
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
          area: spatial.area(shape),
        }
      )
    );
  }
}
function lakeShape(state: GenerationState, parts: Geometry[]) {
  const union = spatial.unionAll(parts);
  return union && spatial.intersection(union, state.domain.scope.footprint);
}
function lakeBody(state: GenerationState, i: number) {
  const work = state.physical!,
    native = work.samples[i];
  return state.surface.active[i] && work.map.WaterKindCodes[native] === 2
    ? work.map.WaterBodyIds[native]
    : -1;
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
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.neighbors[members[head] * 3 + edge];
      if (j < 0 || j >= visited.length || visited[j] >= 0 || !includes(j)) continue;
      visited[j] = region;
      members.push(j);
    }
  return members;
}
function components(
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
  const { surface: grid, physical: work } = state;
  const parts = new Map<number, Geometry[]>();
  const label = (i: number) => (grid.active[i] ? (labels[work!.samples[i]] ?? -1) : -1);
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const region = label(y * grid.width + x),
        start = x;
      if (region < 0) continue;
      while (x + 1 < grid.width && label(y * grid.width + x + 1) === region) x++;
      if (!parts.has(region)) parts.set(region, []);
      parts.get(region)!.push(cellPolygon(grid, start, x, y));
    }
  const result = new Map<number, Geometry>();
  for (const [id, strips] of parts) {
    const shape = lakeShape(state, strips);
    if (shape) result.set(id, shape);
  }
  return result;
}
function publishPlace(
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
  const classes: [string, string, (i: number) => boolean][] = [
    ["peak", "Peak", (i) => map.LandformCodes[i] === Landform.Peak],
    ["cirque", "Cirque", (i) => map.LandformCodes[i] === Landform.Cirque],
    ["fjord", "Fjord", (i) => map.LandformCodes[i] === Landform.Fjord],
    ["moraine", "Moraine", (i) => map.LandformCodes[i] === Landform.Moraine],
    ["waterfall", "Waterfall", (i) => map.LandformCodes[i] === Landform.Waterfall],
    ["gorge", "Gorge", (i) => map.LandformCodes[i] === Landform.Gorge],
  ];
  for (const [kind, name, includes] of classes)
    components(
      state,
      includes,
      (members, extent) => publishPlace(state, kind, name, members, "geology", {}, extent),
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

import { spatial, point } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { cellPolygon, generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { triangleIdentity } from "./mesh";
import { Feature, Landform } from "./codes";

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
      generatedFeature(state, `lake:${body}`, `Lake ${body}`, "lake", "lakes", shape, {
        sourceAlgorithm: "canonry-0f62584c",
        waterBody: body,
        area: spatial.area(shape),
      })
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
function components(
  state: GenerationState,
  includes: (i: number) => boolean,
  publish: (members: number[]) => void
) {
  const map = state.physical!.map,
    visited = new Uint8Array(map.mesh.contentCount);
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] || !includes(i)) continue;
    const members = [i];
    visited[i] = 1;
    for (let head = 0; head < members.length; head++)
      for (let edge = 0; edge < 3; edge++) {
        const j = map.mesh.neighbors[members[head] * 3 + edge];
        if (j < 0 || j >= visited.length || visited[j] || !includes(j)) continue;
        visited[j] = 1;
        members.push(j);
      }
    publish(members);
  }
}
function publishPlace(
  state: GenerationState,
  kind: string,
  name: string,
  members: number[],
  layer: string,
  attributes: Record<string, unknown> = {}
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
  const geometry = point(nativePosition(work, representative));
  const identity = triangleIdentity(map.mesh, representative);
  putGenerated(
    state,
    generatedFeature(
      state,
      `${kind}:${identity}`,
      `${name} ${Math.abs(identity)}`,
      kind,
      layer,
      geometry,
      {
        sourceAlgorithm: "canonry-0f62584c",
        triangles: members.length,
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
    ["crater", "Impact crater", (i) => Boolean(map.FeatureFlags[i] & Feature.ImpactCenter)],
    ["volcano", "Volcano", (i) => Boolean(map.FeatureFlags[i] & Feature.VolcanicCone)],
    ["caldera", "Caldera", (i) => Boolean(map.FeatureFlags[i] & Feature.VolcanicCaldera)],
    ["cirque", "Cirque", (i) => map.LandformCodes[i] === Landform.Cirque],
    ["fjord", "Fjord", (i) => map.LandformCodes[i] === Landform.Fjord],
    ["moraine", "Moraine", (i) => map.LandformCodes[i] === Landform.Moraine],
    ["waterfall", "Waterfall", (i) => map.LandformCodes[i] === Landform.Waterfall],
    ["gorge", "Gorge", (i) => map.LandformCodes[i] === Landform.Gorge],
  ];
  for (const [kind, name, includes] of classes)
    components(state, includes, (members) => publishPlace(state, kind, name, members, "geology"));
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
        (region) =>
          publishPlace(state, `${field.definition.id}:${rule.id}`, rule.name, region, "magic", {
            system: field.definition.id,
            rule: rule.id,
            maximumIntensity: region.reduce((peak, i) => Math.max(peak, field.intensity[i]), 0),
            accumulatedActivity: region.reduce((sum, i) => sum + field.history[i], 0),
          })
      );
    }
}

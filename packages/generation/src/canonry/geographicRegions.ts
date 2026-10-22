import { spatial, point, geometryParts, categoryRegions } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { Landform } from "./codes";
import { lakeFootprint } from "./geographicContours";
import { regionShape, regionTracer, type CausalRegion } from "./causalRegions";
import { categoryRegion } from "./categoryGeography";
import { magicKey } from "./magicState";
import { physicalFieldReader } from "./continuousState";
import { nearestTriangle } from "./mesh";

export function extractLakes(
  state: GenerationState,
  publish = true,
  prepared?: { id: number; footprint: Geometry; level: number }[]
) {
  const map = state.physical!.map,
    mesh = map.mesh;
  const lakes: { id: number; footprint: Geometry; level: number }[] = [];
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
    const contour = prepared
      ? (prepared.find((lake) => lake.id === body)?.footprint ?? null)
      : lakeFootprint(state, members, body, level);
    const shape = clipRegion(state, contour);
    if (!shape) continue;
    lakes.push({ id: body, footprint: shape, level: (level - map.BaseSeaLevel) / 1024 });
    if (!publish) continue;
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
  return lakes;
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
  publish: (members: number[], geometry?: Geometry) => void
) {
  const map = state.physical!.map,
    visited = new Int32Array(map.mesh.contentCount).fill(-1),
    regions: number[][] = [];
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] >= 0 || !includes(i)) continue;
    regions.push(connectedMembers(state, visited, includes, i, regions.length));
  }
  regions.forEach((members) => publish(members));
}
function predicateRegions(
  state: GenerationState,
  region: CausalRegion,
  publish: (members: number[], extent: Geometry, component: number) => void,
  trace = regionTracer(state),
  seed?: Geometry | null
) {
  if (seed === null) return;
  const shape = trace(region);
  if (!shape) return;
  const map = state.physical!.map;
  let component = 0;
  for (const part of geometryParts(shape)) {
    if (part.type !== "Polygon") continue;
    if (seed) {
      const reached = spatial.intersection(seed, part);
      if (!reached || spatial.area(reached) <= 0) continue;
    }
    const covers = spatial.pointCoverage(part);
    const owned = Array.from({ length: map.mesh.contentCount }, (_, i) => i).filter((i) =>
      covers(nativePosition(state.physical!, i))
    );
    const clipped = clipRegion(state, part);
    if (!clipped) continue;
    if (!owned.length) {
      const p = spatial.interiorPosition(clipped);
      owned.push(nearestTriangle(map.mesh, p.x - map.mesh.origin[0], p.y - map.mesh.origin[1]));
    }
    publish(owned, clipped, component++);
  }
}
export function publishPlace(
  state: GenerationState,
  kind: string,
  name: string,
  members: number[],
  layer: string,
  attributes: Record<string, unknown> = {},
  extent?: Geometry,
  component?: string,
  pointOnly = false
) {
  const work = state.physical!,
    map = work.map;
  const covers = spatial.pointCoverage(state.domain.scope.footprint);
  let representative = -1;
  for (const i of members) {
    if (!covers(nativePosition(work, i))) continue;
    if (representative < 0 || map.Elevation[i] > map.Elevation[representative]) representative = i;
  }
  if (representative < 0 && !extent) return;
  const candidate = representative < 0 ? null : nativePosition(work, representative);
  const position =
      extent && (!candidate || !spatial.pointCoverage(extent)(candidate))
        ? spatial.interiorPosition(extent)
        : candidate!,
    geometry = !pointOnly && extent ? extent : point(position);
  const identity = coordinateKey(position.x, position.y);
  putGenerated(
    state,
    generatedFeature(
      state,
      `${kind}:${identity}${component === undefined ? "" : `:${component}`}`,
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
        elevation:
          (physicalFieldReader(map, "Elevation")(
            position.x - map.mesh.origin[0],
            position.y - map.mesh.origin[1]
          ) -
            map.BaseSeaLevel) /
          1024,
        ...attributes,
      }
    )
  );
}
export function extractNamedLandforms(state: GenerationState) {
  const trace = regionTracer(state);
  const regions = categoryRegions(state.surface, "landform");
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: Geometry) => shape;
  const classes: [string, string, number][] = [
    ["peak", "Peak", Landform.Peak],
    ["cirque", "Cirque", Landform.Cirque],
    ["fjord", "Fjord", Landform.Fjord],
    ["moraine", "Moraine", Landform.Moraine],
    ["waterfall", "Waterfall", Landform.Waterfall],
    ["gorge", "Gorge", Landform.Gorge],
  ];
  for (const [kind, name, code] of classes) {
    const publish = (members: number[], extent?: Geometry, component?: number) => {
      const surface = extent && kind !== "fjord" ? dry(extent) : extent;
      if (extent && !surface) return;
      publishPlace(
        state,
        kind,
        name,
        members,
        "geology",
        {},
        surface ?? undefined,
        component?.toString(),
        ["peak", "waterfall"].includes(kind)
      );
    };
    predicateRegions(state, regionShape(regions.get(code) ?? null), publish, trace);
  }
}
export function extractMagicPlaces(state: GenerationState) {
  const magic = state.physical!.magic;
  const trace = regionTracer(state);
  for (const field of magic?.fields ?? [])
    for (const rule of field.definition.features) {
      const members = field.features[rule.id];
      if (!members) continue;
      predicateRegions(
        state,
        regionShape(
          categoryRegion(state, magicKey(field, `feature:${rule.id}`), (code) => code === 1)
        ),
        (region, extent, component) =>
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
            extent,
            component.toString()
          ),
        trace
      );
    }
}

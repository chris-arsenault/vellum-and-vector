import { spatial, point } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { Landform } from "./codes";
import {
  combinedContour,
  fillSmallHoles,
  lakeFootprint,
  membershipContour,
  areaGeometry,
} from "./geographicContours";
import { landArea, largestRegionShare, partitionRegion } from "./regionPartition";
import { naturalPlaceGeometry, magicPlaceGeometry, type PlaceGeometry } from "./placeGeometry";

/** Largest enclosed gap, in square metres, that a landform or magic region absorbs. */
const smallHole = 2_000_000_000;

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
    const contour = lakeFootprint(state, members, body, level);
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
  return areaGeometry(shape && spatial.intersection(shape, state.domain.scope.footprint));
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
  polygonal = false,
  maximum = Infinity
) {
  const map = state.physical!.map,
    visited = new Int32Array(map.mesh.contentCount).fill(-1),
    regions: number[][] = [];
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] >= 0 || !includes(i)) continue;
    const members = connectedMembers(state, visited, includes, i, regions.length);
    // Oversized regions split along drainage divides; each piece is its own label.
    for (const piece of partitionRegion(state, members, maximum)) {
      piece.forEach((cell) => (visited[cell] = regions.length));
      regions.push(piece);
    }
  }
  const shapes = polygonal ? regionShapes(state, visited) : new Map<number, Geometry>();
  regions.forEach((members, i) => publish(members, shapes.get(i)));
}
/**
 * A region's outline at half membership. Where pieces of a split region touch, the outline
 * follows the region's share less its largest neighbour's, so three pieces meeting at a point
 * all reach zero there and the pieces tile without gaps.
 */
function labelContour(state: GenerationState, labels: Int32Array, label: number, leaves: number[]) {
  const mesh = state.physical!.map.mesh,
    touching = new Set<number>();
  for (const i of leaves)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const other = labels[mesh.neighbors[i * mesh.stride + edge]];
      if (other >= 0 && other !== label) touching.add(other);
    }
  if (!touching.size)
    return membershipContour(state, leaves, (cell) => Number(labels[cell] === label));
  const terms = [label, ...touching].map(
    (value) => (cell: number) => Number(labels[cell] === value)
  );
  return combinedContour(state, leaves, terms, ([own, ...others]) => {
    const shared = others.reduce((sum, value) => sum + value, 0);
    return own - Math.max(0.5 * (1 - shared), ...others);
  });
}
function regionShapes(state: GenerationState, labels: Int32Array) {
  const members = new Map<number, number[]>();
  labels.forEach((label, cell) => {
    if (label < 0) return;
    if (!members.has(label)) members.set(label, []);
    members.get(label)!.push(cell);
  });
  const result = new Map<number, Geometry>(),
    water = state.physical!.map.WaterKindCodes;
  for (const [label, leaves] of members) {
    const outline = labelContour(state, labels, label, leaves),
      wet = water[leaves[0]] !== 0;
    // Enclosed gaps of the same medium join the region; islands and lakes stay open.
    const shape = clipRegion(
      state,
      outline &&
        fillSmallHoles(
          state,
          outline,
          smallHole,
          (cell) => (water[cell] !== 0) !== wet || (labels[cell] >= 0 && labels[cell] !== label)
        )
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
  extent?: Geometry,
  placement?: PlaceGeometry | null
) {
  const work = state.physical!;
  const representative = placeRepresentative(state, members);
  if (representative < 0) return;
  const identityPosition = nativePosition(work, representative);
  const position = nativePosition(work, placement?.anchor ?? representative),
    geometry = placement?.geometry ?? extent ?? point(position);
  const identity = coordinateKey(identityPosition.x, identityPosition.y);
  const feature = generatedFeature(state, `${kind}:${identity}`, name, kind, layer, geometry, {
    ...placeAttributes(state, name, members, representative, extent, placement),
    ...attributes,
  });
  if (extent && !geometry.type.includes("Polygon")) feature.footprint = extent;
  putGenerated(state, feature);
}
function placeRepresentative(state: GenerationState, members: number[]) {
  const covers = spatial.pointCoverage(state.domain.scope.footprint),
    work = state.physical!;
  let representative = -1;
  for (const i of members) {
    if (!covers(nativePosition(work, i))) continue;
    if (representative < 0 || work.map.Elevation[i] > work.map.Elevation[representative])
      representative = i;
  }
  return representative;
}
function placeAttributes(
  state: GenerationState,
  name: string,
  members: number[],
  representative: number,
  extent?: Geometry,
  placement?: PlaceGeometry | null
) {
  const work = state.physical!,
    anchor = placement?.anchor ?? representative;
  return {
    sourceAlgorithm: "canonry-0f62584c",
    area: extent
      ? spatial.area(extent)
      : members.reduce((sum, i) => sum + work.map.mesh.areas[i], 0),
    representative: nativePosition(work, anchor),
    placeType: name,
    geometryMeaning: placement?.meaning ?? "classified geographic region",
    elevation: (work.map.Elevation[anchor] - work.map.BaseSeaLevel) / 1024,
  };
}
export function extractNamedLandforms(state: GenerationState) {
  const map = state.physical!.map;
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: Geometry) => shape;
  const classes: [string, string, (i: number) => boolean][] = [
    ["cirque", "Cirque", (i) => map.LandformCodes[i] === Landform.Cirque],
    ["fjord", "Fjord", (i) => map.LandformCodes[i] === Landform.Fjord],
    ["moraine", "Moraine", (i) => map.LandformCodes[i] === Landform.Moraine],
    ["waterfall", "Waterfall", (i) => map.LandformCodes[i] === Landform.Waterfall],
    ["gorge", "Gorge", (i) => map.LandformCodes[i] === Landform.Gorge],
  ];
  const maximum = largestRegionShare * landArea(state);
  for (const [kind, name, includes] of classes)
    components(
      state,
      includes,
      (members, extent) => {
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
          naturalPlaceGeometry(state, kind, members, surface ?? undefined)
        );
      },
      kind !== "waterfall",
      kind === "fjord" ? Infinity : maximum
    );
}
export function extractMagicPlaces(state: GenerationState) {
  const magic = state.physical!.magic;
  for (const held of Object.values(magic?.confluences.states ?? {}))
    components(
      state,
      (i) => Boolean(held.members[i]) && held.coverage[i] > 0,
      (region, extent) =>
        publishPlace(
          state,
          `confluence:${held.definition.id}`,
          held.definition.name,
          region,
          "magic",
          {
            system: "confluence",
            rule: held.definition.id,
            systems: held.definition.systems.join(","),
            meanCoverage:
              region.reduce((sum, i) => sum + held.coverage[i], 0) / Math.max(1, region.length),
            maximumStrain: region.reduce(
              (peak, i) => Math.max(peak, magic!.confluences.strain[i]),
              0
            ),
          },
          extent,
          null
        ),
      true
    );
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
            extent,
            extent ? magicPlaceGeometry(state, field, rule.id, region, extent) : null
          ),
        true
      );
    }
}

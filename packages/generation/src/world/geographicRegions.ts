import { CellList, SmallIntSet, spatial, point, placeMinimumCells, type Band } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import {
  combinedContour,
  fillSmallHoles,
  membershipContour,
  areaGeometry,
} from "./geographicContours";
import { landArea } from "./regionPartition";
import type { PlaceGeometry } from "./placeGeometry";
import type { RegionMembers } from "./regionMembers";
import { workingValues, releaseWorking } from "./physicalNumerics";
import { partitionWorldRegion } from "./worldRegionPartition";
import { significantMagicArea } from "./worldMagicSignificance";
export { extractLakes } from "./lakeFeatures";

/** Largest enclosed gap, in square metres, that a landform or magic region absorbs. */
const smallHole = 2_000_000_000;

function clipRegion(state: GenerationState, shape: Geometry | null) {
  return areaGeometry(shape && spatial.intersection(shape, state.domain.scope.footprint));
}
function connectedMembers(
  state: GenerationState,
  visited: Band,
  includes: (i: number) => boolean,
  start: number,
  region: number
) {
  const members = new CellList(),
    mesh = state.physical!.map.mesh;
  members.push(start);
  visited.set(start, region);
  for (let head = 0; head < members.length; head++) {
    const cell = members.at(head);
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const j = mesh.neighbor(cell, edge);
      if (j < 0 || visited.get(j) >= 0 || !includes(j)) continue;
      visited.set(j, region);
      members.push(j);
    }
  }
  return members.finish();
}
export function components(
  state: GenerationState,
  includes: (i: number) => boolean,
  publish: (members: Int32Array, geometry?: Geometry) => void,
  polygonal = false,
  splits = false,
  weight?: (i: number) => number
) {
  const map = state.physical!.map,
    mesh = map.mesh,
    // Regions are made of content cells; the halo never starts or joins one.
    content = (i: number) => mesh.membership(i) === 1 && includes(i),
    visited = workingValues(map, "int32", "region:labels", (i) => (content(i) ? -2 : -1)),
    // A splittable kind divides only a continental domain at the map's scale, on every map.
    land = splits ? landArea(state) : null;
  let serial = 0;
  for (let i = 0; i < visited.length; i++) {
    if (visited.get(i) !== -2) continue;
    const members = connectedMembers(state, visited, content, i, serial);
    const pieces = land === null ? [members] : partitionWorldRegion(state, members, land);
    pieces.forEach((piece, n) => piece.forEach((cell) => visited.set(cell, serial + n)));
    pieces.forEach((piece, n) =>
      publish(piece, polygonal ? regionShape(state, visited, serial + n, piece, weight) : undefined)
    );
    serial += pieces.length;
  }
  releaseWorking(map, visited);
}
/**
 * A region's outline at half membership, or at half its peak coverage where the members
 * carry a weight. Where pieces of a split region touch, the outline follows the region's
 * share less its largest neighbour's, so three pieces meeting at a point all reach zero
 * there and the pieces tile without gaps.
 */
function labelContour(
  state: GenerationState,
  labels: Band,
  label: number,
  leaves: RegionMembers,
  weight?: (i: number) => number
) {
  const mesh = state.physical!.map.mesh,
    touching = new SmallIntSet();
  for (const i of leaves)
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0) continue;
      const other = labels.get(j);
      if (other >= 0 && other !== label) touching.add(other);
    }
  const peak = weight ? leaves.reduce((maximum, i) => Math.max(maximum, weight(i)), 1e-9) : 1,
    share = (cell: number) => (labels.get(cell) === label ? (weight ? weight(cell) / peak : 1) : 0);
  if (!touching.size) return membershipContour(state, leaves, share);
  const terms = [label, ...touching.items()].map((value) =>
    value === label ? share : (cell: number) => Number(labels.get(cell) === value)
  );
  return combinedContour(state, leaves, terms, ([own, ...others]) => {
    const shared = others.reduce((sum, value) => sum + value, 0);
    return own - Math.max(0.5 * (1 - shared), ...others);
  });
}
function regionShape(
  state: GenerationState,
  labels: Band,
  label: number,
  leaves: RegionMembers,
  weight?: (i: number) => number
) {
  const water = state.physical!.map.WaterKindCodes,
    outline = labelContour(state, labels, label, leaves, weight),
    wet = water.get(leaves[0]) !== 0;
  // Enclosed gaps of the same medium join the region; islands and lakes stay open.
  return (
    clipRegion(
      state,
      outline &&
        fillSmallHoles(state, outline, smallHole, (cell) => {
          const held = labels.get(cell);
          return (water.get(cell) !== 0) !== wet || (held !== -1 && held !== label);
        })
    ) ?? undefined
  );
}
/** The outline of a group of cells, at half membership or half its peak weight. */
export function regionOutline(
  state: GenerationState,
  cells: RegionMembers,
  weight?: (i: number) => number
) {
  const map = state.physical!.map,
    labels = workingValues(map, "int32", "region:outline", () => -1);
  for (const cell of cells) labels.set(cell, 0);
  try {
    return regionShape(state, labels, 0, cells, weight);
  } finally {
    releaseWorking(map, labels);
  }
}
/** A place's record, or null when none of its cells lies on this map's footprint. */
export function placeFeature(
  state: GenerationState,
  kind: string,
  name: string,
  members: RegionMembers,
  layer: string,
  attributes: Record<string, unknown> = {},
  extent?: Geometry,
  placement?: PlaceGeometry | null,
  relations: import("@atlas/domain").AtlasFeature["relations"] = []
) {
  const work = state.physical!;
  const representative = placeRepresentative(state, members);
  if (representative < 0) return null;
  const identityPosition = nativePosition(work, representative);
  const geometry = placement?.geometry ?? extent ?? point(identityPosition);
  const identity = coordinateKey(identityPosition.x, identityPosition.y);
  const feature = generatedFeature(state, `${kind}:${identity}`, name, kind, layer, geometry, {
    ...placeAttributes(state, name, members, representative, extent, placement),
    ...attributes,
  });
  if (extent && !geometry.type.includes("Polygon")) feature.footprint = extent;
  feature.relations = relations;
  return feature;
}
export function publishPlace(...args: Parameters<typeof placeFeature>) {
  const feature = placeFeature(...args);
  if (feature) putGenerated(args[0], feature);
}
function placeRepresentative(state: GenerationState, members: RegionMembers) {
  const covers = spatial.pointCoverage(state.domain.scope.footprint),
    work = state.physical!;
  let representative = -1;
  for (const i of members) {
    if (!covers(nativePosition(work, i))) continue;
    if (representative < 0 || work.map.Elevation.get(i) > work.map.Elevation.get(representative))
      representative = i;
  }
  return representative;
}
function placeAttributes(
  state: GenerationState,
  name: string,
  members: RegionMembers,
  representative: number,
  extent?: Geometry,
  placement?: PlaceGeometry | null
) {
  const work = state.physical!,
    anchor = placement?.anchor ?? representative;
  return {
    sourceAlgorithm: "atlas-1",
    area: extent
      ? spatial.area(extent)
      : members.reduce((sum, i) => sum + work.map.mesh.area(i), 0),
    representative: nativePosition(work, anchor),
    placeType: name,
    geometryMeaning: placement?.meaning ?? "classified geographic region",
    elevation: (work.map.Elevation.get(anchor) - work.map.BaseSeaLevel) / 1024,
  };
}
/** Where systems meet: a meeting is a process between them, not a kind of place of one. */
export function extractConfluencePlaces(state: GenerationState) {
  const magic = state.physical!.magic;
  for (const held of Object.values(magic?.confluences.states ?? {}))
    components(
      state,
      (i) => Boolean(held.members.get(i)) && held.coverage.get(i) > 0,
      (region, extent) =>
        region.length >= placeMinimumCells.area &&
        significantMagicArea(state, region, (i) => held.coverage.get(i)) &&
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
              region.reduce((sum, i) => sum + held.coverage.get(i), 0) / Math.max(1, region.length),
            maximumStrain: region.reduce(
              (peak, i) => Math.max(peak, magic!.confluences.strain.get(i)),
              0
            ),
          },
          extent,
          null
        ),
      true,
      false,
      (i) => held.coverage.get(i)
    );
}

import { CellList, spatial, point, type MagicFeatureRule } from "@atlas/domain";
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
import type { MagicField } from "./magicState";
import type { NumericalVector } from "@atlas/domain";
import type { RegionMembers } from "./regionMembers";
import { workingValues, releaseWorking } from "./physicalNumerics";
import { lakeMembership } from "./lakeMembership";

/** Largest enclosed gap, in square metres, that a landform or magic region absorbs. */
const smallHole = 2_000_000_000;

export function extractLakes(state: GenerationState) {
  const map = state.physical!.map,
    mesh = map.mesh;
  const membership = lakeMembership(map);
  // A visible lake can continue into the numerical halo. Trace its complete
  // basin before clipping; truncating its support leaves an open shoreline.
  try {
    for (const [body, held] of membership.bodies) {
      if (held.first >= mesh.contentCount) continue;
      const members = membership.members(body);
      const level = map.WaterSurfaceElevations[held.first];
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
  } finally {
    membership.close();
  }
}
function clipRegion(state: GenerationState, shape: Geometry | null) {
  return areaGeometry(shape && spatial.intersection(shape, state.domain.scope.footprint));
}
function connectedMembers(
  state: GenerationState,
  visited: NumericalVector,
  includes: (i: number) => boolean,
  start: number,
  region: number
) {
  const members = new CellList(),
    mesh = state.physical!.map.mesh;
  members.push(start);
  visited[start] = region;
  for (let head = 0; head < members.length; head++)
    for (let edge = 0; edge < mesh.degree[members.at(head)]; edge++) {
      const j = mesh.neighbors[members.at(head) * mesh.stride + edge];
      if (j < 0 || j >= visited.length || visited[j] >= 0 || !includes(j)) continue;
      visited[j] = region;
      members.push(j);
    }
  return members.finish();
}
export function components(
  state: GenerationState,
  includes: (i: number) => boolean,
  publish: (members: NumericalVector, geometry?: Geometry) => void,
  polygonal = false,
  maximum = Infinity,
  weight?: (i: number) => number
) {
  const map = state.physical!.map,
    visited = workingValues(
      map,
      "int32",
      "region:labels",
      (i) => (includes(i) ? -2 : -1),
      map.mesh.contentCount
    );
  let serial = 0;
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] !== -2) continue;
    const members = connectedMembers(state, visited, includes, i, serial);
    // Oversized regions split along drainage divides; each piece is its own label.
    const pieces = partitionRegion(state, members, maximum);
    pieces.forEach((piece, n) => piece.forEach((cell) => (visited[cell] = serial + n)));
    pieces.forEach((piece, n) =>
      publish(piece, polygonal ? regionShape(state, visited, serial + n, piece, weight) : undefined)
    );
    serial += pieces.length;
    releaseWorking(map, members, ...pieces);
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
  labels: NumericalVector,
  label: number,
  leaves: RegionMembers,
  weight?: (i: number) => number
) {
  const mesh = state.physical!.map.mesh,
    touching = new Set<number>();
  for (const i of leaves)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const other = labels[mesh.neighbors[i * mesh.stride + edge]];
      if (other >= 0 && other !== label) touching.add(other);
    }
  const peak = weight ? leaves.reduce((maximum, i) => Math.max(maximum, weight(i)), 1e-9) : 1,
    share = (cell: number) => (labels[cell] === label ? (weight ? weight(cell) / peak : 1) : 0);
  if (!touching.size) return membershipContour(state, leaves, share);
  const terms = [label, ...touching].map((value) =>
    value === label ? share : (cell: number) => Number(labels[cell] === value)
  );
  return combinedContour(state, leaves, terms, ([own, ...others]) => {
    const shared = others.reduce((sum, value) => sum + value, 0);
    return own - Math.max(0.5 * (1 - shared), ...others);
  });
}
function regionShape(
  state: GenerationState,
  labels: NumericalVector,
  label: number,
  leaves: RegionMembers,
  weight?: (i: number) => number
) {
  const water = state.physical!.map.WaterKindCodes,
    outline = labelContour(state, labels, label, leaves, weight),
    wet = water[leaves[0]] !== 0;
  // Enclosed gaps of the same medium join the region; islands and lakes stay open.
  return (
    clipRegion(
      state,
      outline &&
        fillSmallHoles(
          state,
          outline,
          smallHole,
          (cell) => (water[cell] !== 0) !== wet || (labels[cell] !== -1 && labels[cell] !== label)
        )
    ) ?? undefined
  );
}
export function publishPlace(
  state: GenerationState,
  kind: string,
  name: string,
  members: RegionMembers,
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
function placeRepresentative(state: GenerationState, members: RegionMembers) {
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
  members: RegionMembers,
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
/**
 * The fewest cells a class component needs to be a published place. A site is one located
 * source, so one cell is a place. An area a cell or two wide, or a course of one cell, is a
 * mark on the field and not a place: the class stays on the map as coverage whatever its
 * size, and only the named, outlined place needs the extent (ADR 0005: outlines generalize
 * a realized field at the minima declared with the rules).
 */
const placeMinimumCells: Record<NonNullable<MagicFeatureRule["cartography"]>, number> = {
  site: 1,
  course: 2,
  area: 3,
};
export function extractMagicPlaces(state: GenerationState) {
  const magic = state.physical!.magic;
  for (const held of Object.values(magic?.confluences.states ?? {}))
    components(
      state,
      (i) => Boolean(held.members[i]) && held.coverage[i] > 0,
      (region, extent) =>
        region.length >= placeMinimumCells.area &&
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
      true,
      Infinity,
      (i) => held.coverage[i]
    );
  for (const field of magic?.fields ?? [])
    for (const rule of field.definition.features) publishRulePlaces(state, field, rule);
}
/**
 * Every component of one rule's class past its cartography's minimum, as a named place. An
 * area or a site complex that would span more of the land than a landform may is split along
 * drainage divides into several named places, as forests and landforms are: one Aurora field
 * over a tenth of the land, or one light well of five hundred cells, is not one place. A
 * course keeps its whole length.
 */
function publishRulePlaces(state: GenerationState, field: MagicField, rule: MagicFeatureRule) {
  const cartography = rule.cartography ?? "area",
    members = field.features[rule.id],
    coverage = field.coverage[rule.id],
    minimum = placeMinimumCells[cartography],
    maximum = cartography === "course" ? Infinity : largestRegionShare * landArea(state),
    areas = state.physical!.map.mesh.areas;
  if (!members) return;
  components(
    state,
    (i) => Boolean(members[i]) && (coverage?.[i] ?? 1) > 0,
    (region, extent) =>
      region.length >= minimum &&
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
            region.reduce((sum, i) => sum + field.history[i] * areas[i], 0) /
            region.reduce((sum, i) => sum + areas[i], 0),
        },
        extent,
        extent ? magicPlaceGeometry(state, field, rule.id, region, extent) : null
      ),
    true,
    maximum,
    coverage ? (i) => coverage[i] : undefined
  );
}

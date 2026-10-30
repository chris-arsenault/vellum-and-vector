import {
  CellList,
  SmallIntSet,
  spatial,
  point,
  placeMinimumCells,
  type Band,
  type MagicFeatureRule,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { nativePosition } from "./atlasWorkspace";
import { coordinateKey } from "./worldSources";
import { Landform } from "./codes";
import {
  combinedContour,
  fillSmallHoles,
  membershipContour,
  areaGeometry,
} from "./geographicContours";
import { landArea, largestRegionShare, partitionRegion } from "./regionPartition";
import { naturalPlaceGeometry, magicPlaceGeometry, type PlaceGeometry } from "./placeGeometry";
import type { MagicField } from "./magicState";
import type { RegionMembers } from "./regionMembers";
import { workingValues, releaseWorking } from "./physicalNumerics";
import { isWorldGeography } from "../worldSignificance";
import { partitionWorldRegion } from "./worldRegionPartition";
import { significantLandform } from "./worldSiteEvidence";
import { significantMagicArea, significantMagicPlace } from "./worldMagicSignificance";
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
  maximum = Infinity,
  weight?: (i: number) => number
) {
  const map = state.physical!.map,
    mesh = map.mesh,
    // Regions are made of content cells; the halo never starts or joins one.
    content = (i: number) => mesh.membership(i) === 1 && includes(i),
    visited = workingValues(map, "int32", "region:labels", (i) => (content(i) ? -2 : -1)),
    worldLand = isWorldGeography(state) && Number.isFinite(maximum) ? landArea(state) : null;
  let serial = 0;
  for (let i = 0; i < visited.length; i++) {
    if (visited.get(i) !== -2) continue;
    const members = connectedMembers(state, visited, content, i, serial);
    // Oversized regions split along drainage divides; each piece is its own label.
    const pieces =
      worldLand === null
        ? partitionRegion(state, members, maximum)
        : partitionWorldRegion(state, members, worldLand);
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
export function publishPlace(
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
  if (representative < 0) return;
  const identityPosition = nativePosition(work, representative);
  const geometry = placement?.geometry ?? extent ?? point(identityPosition);
  const identity = coordinateKey(identityPosition.x, identityPosition.y);
  const feature = generatedFeature(state, `${kind}:${identity}`, name, kind, layer, geometry, {
    ...placeAttributes(state, name, members, representative, extent, placement),
    ...attributes,
  });
  if (extent && !geometry.type.includes("Polygon")) feature.footprint = extent;
  feature.relations = relations;
  putGenerated(state, feature);
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
    sourceAlgorithm: "canonry-0f62584c",
    area: extent
      ? spatial.area(extent)
      : members.reduce((sum, i) => sum + work.map.mesh.area(i), 0),
    representative: nativePosition(work, anchor),
    placeType: name,
    geometryMeaning: placement?.meaning ?? "classified geographic region",
    elevation: (work.map.Elevation.get(anchor) - work.map.BaseSeaLevel) / 1024,
  };
}
export function extractNamedLandforms(state: GenerationState) {
  const map = state.physical!.map;
  const dry = state.surface.ocean
    ? spatial.differenceFrom(state.surface.ocean)
    : (shape: Geometry) => shape;
  const classes: [string, string, (i: number) => boolean][] = [
    ["cirque", "Cirque", (i) => map.LandformCodes.get(i) === Landform.Cirque],
    ["fjord", "Fjord", (i) => map.LandformCodes.get(i) === Landform.Fjord],
    ["moraine", "Moraine", (i) => map.LandformCodes.get(i) === Landform.Moraine],
    ["waterfall", "Waterfall", (i) => map.LandformCodes.get(i) === Landform.Waterfall],
    ["gorge", "Gorge", (i) => map.LandformCodes.get(i) === Landform.Gorge],
  ];
  const maximum = largestRegionShare * landArea(state);
  for (const [kind, name, includes] of classes)
    components(
      state,
      includes,
      (members, extent) => {
        if (isWorldGeography(state) && !significantLandform(state, kind, members)) return;
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
export function extractMagicPlaces(state: GenerationState) {
  const magic = state.physical!.magic;
  for (const held of Object.values(magic?.confluences.states ?? {}))
    components(
      state,
      (i) => Boolean(held.members.get(i)) && held.coverage.get(i) > 0,
      (region, extent) =>
        (isWorldGeography(state)
          ? significantMagicArea(state, region, (i) => held.coverage.get(i))
          : region.length >= placeMinimumCells.area) &&
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
      Infinity,
      (i) => held.coverage.get(i)
    );
  for (const field of magic?.fields ?? [])
    for (const rule of field.definition.features) publishRulePlaces(state, field, rule);
}
/** World places require causal significance; finer profiles retain local class components. */
function publishRulePlaces(state: GenerationState, field: MagicField, rule: MagicFeatureRule) {
  const cartography = rule.cartography ?? "area",
    members = field.features[rule.id],
    coverage = field.coverage[rule.id],
    minimum = placeMinimumCells[cartography],
    maximum = cartography === "course" ? Infinity : largestRegionShare * landArea(state),
    mesh = state.physical!.map.mesh;
  if (!members) return;
  components(
    state,
    (i) => Boolean(members.get(i)) && (coverage?.get(i) ?? 1) > 0,
    (region, extent) => {
      const eligible = isWorldGeography(state)
        ? significantMagicPlace(state, field, rule, region)
        : region.length >= minimum;
      if (!eligible) return;
      const placement = extent ? magicPlaceGeometry(state, field, rule.id, region, extent) : null;
      if (isWorldGeography(state) && cartography === "course" && !placement) return;
      publishPlace(
        state,
        `${field.definition.id}:${rule.id}`,
        rule.name,
        region,
        "magic",
        {
          system: field.definition.id,
          rule: rule.id,
          maximumIntensity: region.reduce((peak, i) => Math.max(peak, field.intensity.get(i)), 0),
          accumulatedActivity:
            region.reduce((sum, i) => sum + field.history.get(i) * mesh.area(i), 0) /
            region.reduce((sum, i) => sum + mesh.area(i), 0),
        },
        extent,
        placement
      );
    },
    true,
    maximum,
    coverage ? (i) => coverage.get(i) : undefined
  );
}

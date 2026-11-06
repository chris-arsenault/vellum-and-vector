// OrogenicConstructionLayer cross sections and along-strike relief, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { clamp } from "./math";
import { hashUnit, unitNoise } from "./noise";
import { groundOf } from "../rock/ground";
import { surfaceStanding } from "../rock/groundQueries";

/** The cross-section value at the crest of a convergent belt. */
export const orogenicCrestSection = 1.55;
const gaussian = (value: number, center: number, width: number) =>
  Math.exp(-0.5 * ((value - center) / Math.max(0.001, width)) ** 2);
/**
 * The hinterland carries part of the crest section flat behind the belt and lets it go over the
 * last part of the plateau width: the root budget spread into a plateau rather than a crest.
 */
function plateauShoulder(p: PhysicalProfile, distance: number): number {
  const width = p.OrogenicPlateauWidth;
  if (width <= 0 || p.OrogenicPlateauShare <= 0) return 0;
  const t = clamp((distance - width * 0.6) / (width * 0.5), 0, 1);
  return p.OrogenicPlateauShare * (1 - t * t * (3 - 2 * t));
}
/** How far out from a rift its blocks reach. */
export const sheetReach = (p: PhysicalProfile) => p.RiftShoulderDistance * 3.2;
/** A segment stands higher or lower than the next for what it was built from. */
export const segmentScale = (c: BoundaryComponent, segment: number) =>
  0.75 + 0.5 * hashUnit(c.salt ^ 0x51e4, segment, 1);
/**
 * Which thrust sheet a cell joins when the belt first reaches it, and how far across it. Faults cut
 * a belt into segments along its strike, each with its sheets offset from its neighbours', so
 * ridges step sideways at them. A sheet is as wide as its rock is stiff.
 */
export function sheetAt(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number,
  reach: number
) {
  const p = context.Profile,
    tx = map.TectonicTangentX.get(source) / 1000,
    ty = map.TectonicTangentY.get(source) / 1000,
    along = map.mesh.x(i) * tx + map.mesh.y(i) * ty,
    segment = Math.floor(along / p.OrogenicSegmentLength),
    stiffness = groundOf(map).fold(source, surfaceStanding),
    spacing = p.OrogenicSheetSpacing * stiffness,
    offset = hashUnit(c.salt ^ 0x51e3, segment, 0) * spacing,
    position = (reach + offset) / spacing,
    sheet = Math.floor(position);
  return { sheet, across: position - sheet, segment };
}
const sheetHeld = (map: PhysicalField, c: BoundaryComponent, i: number) =>
  map.ThrustPairIds.get(i) === c.pair + 1;
/**
 * What a pass of shortening does at a cell it has reached: the sheets nearest the front take the
 * most of it, older ones behind are carried along with less, and where a sheet's leading edge has
 * just ridden over the next, the rock is stacked and takes most of all.
 */
function stackedThrust(map: PhysicalField, c: BoundaryComponent, frame: OrogenicFrame, i: number) {
  if (!sheetHeld(map, c, i)) return 0;
  const behind = Math.max(0, c.frontSheet - (map.ThrustSheetIndex.get(i) - 1)),
    stacked = frame.overlap.get(i);
  return (
    1.25 * 0.62 ** behind * (0.3 + 0.7 * stacked) * segmentScale(c, map.ThrustSegmentIds.get(i))
  );
}
/**
 * Stretching breaks crust into fault blocks: each one tilted, the alternate ones dropped, and each
 * the same block on every pass, so a block's tilt grows. The rift's axis thins most, and the blocks
 * run out from it until the stretch is spent.
 */
function faultBlocks(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  distance: number
) {
  const p = context.Profile,
    axis = gaussian(distance, 0, Math.max(2, p.RiftShoulderDistance * 0.48)) * 0.76;
  if (!sheetHeld(map, c, i)) return -axis;
  const across = map.ThrustAcross.get(i) / 1000,
    block = map.ThrustSheetIndex.get(i) - 1,
    tilt = block % 2 === 0 ? 0.55 * across : -0.5 * (1 - across);
  return (
    gaussian(distance, 0, p.RiftShoulderDistance * 1.6) *
      tilt *
      segmentScale(c, map.ThrustSegmentIds.get(i)) -
    axis
  );
}
/**
 * Cross-section of a belt at a cell. A convergent belt is what its carried sheets have stacked,
 * with the plateau shoulder behind them on the hinterland; a rift is its blocks.
 */
export function crossSection(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number
): number {
  const p = context.Profile,
    continental = map.CrustContinentalFraction.get(i) / 1000,
    distance = frame.distance.get(i);
  if (c.code === 1) {
    const plateau = frame.side.get(i) < 0 ? 0 : plateauShoulder(p, distance) * continental;
    return stackedThrust(map, c, frame, i) * (0.4 + continental * 0.6) + plateau;
  }
  if (c.code === 2) return continental * faultBlocks(map, context, c, i, distance);
  return c.code === 3
    ? gaussian(distance, 0, p.TransformRangeWidth) * (0.06 + continental * 0.14)
    : 0;
}
function alongNoise(
  map: PhysicalField,
  i: number,
  source: number,
  summit: boolean,
  pair: number,
  seed: number,
  scale: number
): number {
  let tx = map.TectonicTangentX.get(source) / 1000,
    ty = map.TectonicTangentY.get(source) / 1000;
  if (Math.abs(tx) + Math.abs(ty) < 0.01) {
    tx = 1;
    if (!summit) ty = 0;
  }
  const x = map.mesh.x(i),
    y = map.mesh.y(i),
    width = map.mesh.periodic?.width;
  const offset = pair * (summit ? 310_000 : 190_000);
  if (!width) return unitNoise(x * tx + y * ty, offset, seed, scale, 3);
  const phase = ((x % width) + width) % width,
    t = phase / width;
  const a = unitNoise(phase * tx + y * ty, offset, seed, scale, 3);
  const b = unitNoise((phase - width) * tx + y * ty, offset, seed, scale, 3);
  return a + (b - a) * t * t * (3 - 2 * t);
}
export function alongStrike(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number
) {
  const noise = alongNoise(
    map,
    i,
    source,
    false,
    c.pair,
    context.EpochStableSeed ^ 0x6c91,
    context.Profile.OrogenicAlongStrikeScale
  );
  return 0.74 + noise ** 1.7 * 0.54;
}
export function summitVariation(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number
) {
  const noise = alongNoise(
    map,
    i,
    source,
    true,
    c.pair,
    context.EpochStableSeed ^ 0x19d7,
    Math.max(3, context.Profile.OrogenicAlongStrikeScale * 0.28)
  );
  return 0.72 + noise ** 2.1 * 0.68;
}
export function constructionWeight(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number,
  section?: number
): number {
  const source = frame.source.get(i);
  const shape = section ?? crossSection(map, context, c, frame, i);
  const activity = (map.TectonicStrain.get(source) / 1000) * 0.62 + c.strain * 0.38;
  return activity * alongStrike(map, context, c, i, source) * shape;
}

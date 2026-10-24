// OrogenicConstructionLayer cross sections and along-strike relief, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { clamp } from "./math";
import { meshUnitNoise, unitNoise } from "./noise";

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
/**
 * Cross-section of a belt at a signed side: the foreland (side < 0) rises to the crest within a
 * narrower front; the hinterland (side ≥ 0) carries the crest and the plateau shoulder.
 */
export function crossSection(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number,
  distance: number,
  side = 1
): number {
  const p = context.Profile,
    continental = map.CrustContinentalFraction[i] / 1000;
  if (c.code === 1) {
    const mix = clamp(
      (Math.max(map.CrustCollisionIntensity[source] / 1000, c.collision) - 0.08) / 0.42,
      0,
      1
    );
    const front = side < 0 ? p.OrogenicForelandWidthShare : 1;
    const w = p.CollisionRangeWidth * front;
    const collision =
      (gaussian(distance, 0, w) * 0.42 +
        gaussian(distance, w * 0.28, w * 0.17) * 0.9 +
        gaussian(distance, w * 0.72, w * 0.21) * 0.68) *
      (0.4 + continental * 0.6);
    const sw = p.SubductionRangeWidth * front;
    const subduction =
      (gaussian(distance, 0, sw) * 0.26 + gaussian(distance, sw * 0.42, sw * 0.25) * 1.02) *
      continental;
    const plateau = side < 0 ? 0 : plateauShoulder(p, distance) * continental;
    return subduction * (1 - mix) + collision * mix + plateau;
  }
  if (c.code === 2) {
    const d = p.RiftShoulderDistance;
    return (
      continental *
      (gaussian(distance, d, Math.max(2, d * 0.42)) * 0.55 -
        gaussian(distance, 0, Math.max(2, d * 0.48)) * 0.76)
    );
  }
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
  let tx = map.TectonicTangentX[source] / 1000,
    ty = map.TectonicTangentY[source] / 1000;
  if (Math.abs(tx) + Math.abs(ty) < 0.01) {
    tx = 1;
    if (!summit) ty = 0;
  }
  const x = map.mesh.x[i],
    y = map.mesh.y[i],
    width = map.mesh.periodic?.width;
  const offset = pair * (summit ? 310_000 : 190_000);
  if (map.mesh.periodic?.poles) return meshUnitNoise(map.mesh, x, y, seed ^ pair, scale, 3);
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
  const source = frame.source[i];
  const shape =
    section ?? crossSection(map, context, c, i, source, frame.distance[i], frame.side[i]);
  const activity = (map.TectonicStrain[source] / 1000) * 0.62 + c.strain * 0.38;
  return activity * alongStrike(map, context, c, i, source) * shape;
}

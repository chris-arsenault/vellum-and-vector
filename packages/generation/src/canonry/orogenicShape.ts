// OrogenicConstructionLayer cross sections and along-strike relief, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { clamp } from "./math";
import { unitNoise } from "./noise";

const gaussian = (value: number, center: number, width: number) =>
  Math.exp(-0.5 * ((value - center) / Math.max(0.001, width)) ** 2);
export function crossSection(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number,
  distance: number
): number {
  const p = context.Profile,
    continental = map.CrustContinentalFraction[i] / 1000;
  if (c.code === 1) {
    const mix = clamp(
      (Math.max(map.CrustCollisionIntensity[source] / 1000, c.collision) - 0.08) / 0.42,
      0,
      1
    );
    const w = p.CollisionRangeWidth;
    const collision =
      (gaussian(distance, 0, w) * 0.42 +
        gaussian(distance, w * 0.28, w * 0.17) * 0.9 +
        gaussian(distance, w * 0.72, w * 0.21) * 0.68) *
      (0.4 + continental * 0.6);
    const sw = p.SubductionRangeWidth;
    const subduction =
      (gaussian(distance, 0, sw) * 0.26 + gaussian(distance, sw * 0.42, sw * 0.25) * 1.02) *
      continental;
    return subduction * (1 - mix) + collision * mix;
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
function alongPosition(map: PhysicalField, i: number, source: number, summit: boolean): number {
  let tx = map.TectonicTangentX[source] / 1000,
    ty = map.TectonicTangentY[source] / 1000;
  if (Math.abs(tx) + Math.abs(ty) < 0.01) {
    tx = 1;
    if (!summit) ty = 0;
  }
  return map.mesh.x[i] * tx + map.mesh.y[i] * ty;
}
export function alongStrike(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number
) {
  const noise = unitNoise(
    alongPosition(map, i, source, false),
    c.pair * 190_000,
    context.EpochStableSeed ^ 0x6c91,
    context.Profile.OrogenicAlongStrikeScale,
    3
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
  const noise = unitNoise(
    alongPosition(map, i, source, true),
    c.pair * 310_000,
    context.EpochStableSeed ^ 0x19d7,
    Math.max(3, context.Profile.OrogenicAlongStrikeScale * 0.28),
    3
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
  const shape = section ?? crossSection(map, context, c, i, source, frame.distance[i]);
  const activity = (map.TectonicStrain[source] / 1000) * 0.62 + c.strain * 0.38;
  return activity * alongStrike(map, context, c, i, source) * shape;
}

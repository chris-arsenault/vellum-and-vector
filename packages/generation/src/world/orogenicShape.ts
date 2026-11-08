// OrogenicConstructionLayer cross sections and along-strike relief, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { units } from "./math";
import { hashUnit, unitNoise } from "./noise";
import { groundOf } from "../rock/ground";
import { surfaceStanding, yieldingPlane } from "../rock/groundQueries";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { displaceGroundField } from "../rock/groundDeformation";

/** The cross-section value at the crest of a convergent belt. */
export const orogenicCrestSection = 1.55;
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
    stiffness = groundOf(map).fold(i, surfaceStanding),
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
 * Roots enter where shortening has actually engaged sheets. Broad support comes later from
 * the retained thick crust and its flow; no prescribed plateau is added to this allocation.
 */
export function crossSection(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number
): number {
  const continental = map.CrustContinentalFraction.get(i) / 1000;
  return c.code === 1 ? stackedThrust(map, c, frame, i) * (0.4 + continental * 0.6) : 0;
}

const faultPlane = yieldingPlane();
/** Slip follows an existing dip, or first localizes on the more compliant side of a contact. */
export function faultDisplacement(opening: number, first: number, second: number, dip: number) {
  const polarity = Math.sign(dip) || Math.sign(first - second),
    yielding = first + second;
  if (opening === 0 || yielding <= 0 || polarity === 0) return [0, 0] as const;
  return [
    (-opening * polarity * first) / (1 + yielding),
    (opening * polarity * second) / (1 + yielding),
  ] as const;
}
function faultNormal(map: PhysicalField, i: number, j: number, edge: number) {
  const code = map.TectonicBoundaryCodes.get(i),
    source = code === 2 || code === 3 ? i : j,
    active = map.TectonicBoundaryCodes.get(source);
  if (active !== 2 && active !== 3) return null;
  const tx = map.TectonicTangentX.get(source),
    ty = map.TectonicTangentY.get(source),
    length = Math.hypot(tx, ty);
  if (length === 0) return null;
  const sign = Math.sign(-ty * map.mesh.edgeX(i, edge) + tx * map.mesh.edgeY(i, edge));
  return [(-ty * sign) / length, (tx * sign) / length] as const;
}
/** Opening or oblique closure offsets retained blocks; pure strike slip supplies no vertical throw. */
export function displaceFaultBlocks(map: PhysicalField, context: PhysicalContext) {
  const ground = groundOf(map),
    mesh = map.mesh,
    response = workingArray(map, "float64", "faults:response"),
    sx = workingArray(map, "float64", "faults:slopeX"),
    sy = workingArray(map, "float64", "faults:slopeY"),
    movement = workingArray(map, "float64", "faults:movement").fill(0),
    weight = workingArray(map, "float64", "faults:weight").fill(0),
    travel = map.LastPlateDriftStep * context.Profile.ThrustTiltGradient;
  for (let i = 0; i < mesh.count; i++) {
    const plane = ground.fold(i, faultPlane);
    response.set(i, plane.compliance);
    sx.set(i, plane.slopeX);
    sy.set(i, plane.slopeY);
  }
  for (let i = 0; i < mesh.count; i++) {
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j <= i || map.CrustProvinceIds.get(i) === map.CrustProvinceIds.get(j)) continue;
      const normal = faultNormal(map, i, j, edge);
      if (!normal) continue;
      const [nx, ny] = normal,
        opening =
          ((map.CrustMotionX.get(j) - map.CrustMotionX.get(i)) * nx +
            (map.CrustMotionY.get(j) - map.CrustMotionY.get(i)) * ny) /
          1000,
        dip = ((sx.get(i) + sx.get(j)) * nx + (sy.get(i) + sy.get(j)) * ny) / 2,
        [first, second] = faultDisplacement(
          opening * travel,
          response.get(i),
          response.get(j),
          dip
        ),
        face = mesh.faceLength(i, edge);
      movement.add(i, units(first) * face);
      movement.add(j, units(second) * face);
      weight.add(i, face);
      weight.add(j, face);
    }
  }
  for (let i = 0; i < mesh.count; i++)
    if (weight.get(i) > 0) movement.set(i, movement.get(i) / weight.get(i));
  displaceGroundField(map, movement, "fault displacement");
  releaseWorking(map, response, sx, sy, movement, weight);
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

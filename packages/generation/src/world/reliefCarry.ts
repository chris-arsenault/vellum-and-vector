import type { Band } from "@atlas/domain";
import {
  columnKindOffset,
  kindBands,
  layBedOfCode,
  layerDepth,
  rockDepthFields,
  rockLayers,
} from "../rock/rockColumn";
import { shiftRock } from "../rock/groundLedger";
import { newBasaltSurface } from "../rock/rockField";
import { oceanicColumn } from "../rock/rockHistory";
import { adjustCrustColumn, arcCrustYield } from "./crustTransport";
import type { PhysicalField } from "./field";
import { clamp, crustPerRock, elevationLimit, units } from "./math";
import { meshDeltaX, meshPoint } from "./mesh";
import { metricSearch } from "./metricSearch";
import { smoothMetric } from "./metricSmoothing";
import { physicalSampler } from "./physicalMetric";
import { releaseWorking, workingArray, workingValues } from "./physicalNumerics";
import type { TransportPlan } from "./transportPlan";
import { weightScale } from "./transportPlan";

/**
 * Crust moves whole. A plate's move is made of many small steps, and sharing height out over the
 * cells each step touches would plane the land down every time the plates move; taking each step's
 * largest arrival instead would leave the ground behind, since a small step's largest arrival is
 * the cell itself. So each cell follows where its material has come from across the whole move, and
 * when the move ends it takes the height and rock of that place as they stood when it began.
 */
const heights = ["BedrockElevation", "CrustSupportElevation", "SurfaceRockLoad"] as const;
/** Properties of the rock itself, which have no meaning halfway between two rocks. */
const rockProperties = [
  "RockResistance",
  "CrustSutureStrength",
  "CrustProvinceSeam",
  "StructuralGrainX",
  "StructuralGrainY",
  ...rockDepthFields,
] as const;
export interface ReliefCarry {
  before: Band[];
  properties: Band[];
  kinds: Band[];
  fromX: Band;
  fromY: Band;
  /** How much of a cell is crust that was there when the move began, and not new ground. */
  old: Band;
  nextX: Band;
  nextY: Band;
  nextOld: Band;
  /** Where each cell's rock has got to, and how much of its crust is continent. */
  toX: Band;
  toY: Band;
  fraction: Band;
}
export function beginReliefCarry(map: PhysicalField): ReliefCarry {
  return {
    toX: workingValues(map, "float64", "carry:toX", (i) => map.mesh.x(i)),
    toY: workingValues(map, "float64", "carry:toY", (i) => map.mesh.y(i)),
    fraction: map.coverage.copyBand(map.CrustContinentalFraction),
    before: heights.map((name) => map.coverage.copyBand(map[name])),
    properties: rockProperties.map((name) => map.coverage.copyBand(map[name])),
    kinds: kindBands(map).map((band) => map.coverage.copyBand(band)),
    fromX: workingArray(map, "float64", "carry:fromX").fill(0),
    fromY: workingArray(map, "float64", "carry:fromY").fill(0),
    old: workingArray(map, "float64", "carry:old").fill(1),
    nextX: workingArray(map, "float64", "carry:nextX"),
    nextY: workingArray(map, "float64", "carry:nextY"),
    nextOld: workingArray(map, "float64", "carry:nextOld"),
  };
}
/** How far what lies in a cell moves on a step of the plan; none if all of it leaves the mesh. */
function stepFrom(map: PhysicalField, plan: TransportPlan, here: number) {
  let x = 0,
    y = 0,
    kept = 0;
  const end = plan.offsets.get(here + 1);
  for (let offset = plan.offsets.get(here); offset < end; offset++) {
    const target = plan.targets.get(offset),
      weight = plan.weights.get(offset);
    if (target < 0) continue;
    x += weight * meshDeltaX(map.mesh, map.mesh.x(target) - map.mesh.x(here));
    y += weight * (map.mesh.y(target) - map.mesh.y(here));
    kept += weight;
  }
  return kept > 0 ? [x / kept, y / kept] : null;
}
/** Follows each cell's rock forward, so that rock no cell takes up still has a place it went to. */
function followRock(map: PhysicalField, plan: TransportPlan, { toX, toY }: ReliefCarry) {
  for (let source = 0; source < map.mesh.count; source++) {
    if (!Number.isFinite(toX.get(source))) continue;
    const [x, y] = meshPoint(map.mesh, toX.get(source), toY.get(source)),
      here = map.mesh.cellAt(x, y),
      step = here >= 0 ? stepFrom(map, plan, here) : null;
    toX.set(source, step ? x + step[0] : NaN);
    toY.set(source, step ? y + step[1] : NaN);
  }
}
/** A step of the move: each cell learns where what arrived in it had come from. */
export function stepReliefCarry(map: PhysicalField, plan: TransportPlan, carry: ReliefCarry) {
  const mesh = map.mesh,
    { fromX, fromY, old, nextX, nextY, nextOld } = carry;
  followRock(map, plan, carry);
  nextX.fill(0);
  nextY.fill(0);
  nextOld.fill(0);
  for (let source = 0; source < mesh.count; source++) {
    const end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset);
      if (target < 0 || mesh.area(target) <= 0) continue;
      const weight = (plan.weights.get(offset) * mesh.area(source)) / mesh.area(target);
      nextX.add(
        target,
        weight * (fromX.get(source) + meshDeltaX(mesh, mesh.x(source) - mesh.x(target)))
      );
      nextY.add(target, weight * (fromY.get(source) + mesh.y(source) - mesh.y(target)));
      nextOld.add(target, weight * old.get(source));
    }
  }
  for (let cell = 0; cell < mesh.count; cell++) {
    const arrival = plan.arrivals.get(cell);
    fromX.set(cell, arrival > 0 ? nextX.get(cell) / arrival : 0);
    fromY.set(cell, arrival > 0 ? nextY.get(cell) / arrival : 0);
    // What did not arrive here is new ground, opened where the plates parted.
    old.set(
      cell,
      Math.min(nextOld.get(cell) / weightScale, arrival > 0 ? nextOld.get(cell) / arrival : 0)
    );
  }
}
/** A copy of every cell's rock as it stands, for rock moved within a single process. */
export interface HeldRock {
  properties: Band[];
  kinds: Band[];
}
export const holdRock = (map: PhysicalField): HeldRock => ({
  properties: rockProperties.map((name) => map.coverage.copyBand(map[name])),
  kinds: kindBands(map).map((band) => map.coverage.copyBand(band)),
});
export function releaseHeldRock(map: PhysicalField, held: HeldRock) {
  releaseWorking(map, ...held.properties, ...held.kinds);
}
export function takeHeldRock(map: PhysicalField, held: HeldRock, cell: number, origin: number) {
  rockProperties.forEach((name, n) => map[name].set(cell, held.properties[n].get(origin)));
  kindBands(map).forEach((band, n) => band.set(cell, held.kinds[n].get(origin)));
}
/** A cell's place in a belt, from a held cell, leaving its rock as it is. */
export function takeHeldSheet(map: PhysicalField, held: HeldRock, cell: number, origin: number) {
  const bands = kindBands(map);
  for (let n = columnKindOffset + rockLayers; n < bands.length; n++)
    bands[n].set(cell, held.kinds[n].get(origin));
}
/** The layers of a held column from the top down. */
export function heldLayers(held: HeldRock, cell: number) {
  return rockDepthFields.map((name, layer) => ({
    kind: held.kinds[columnKindOffset + layer].get(cell),
    depth: held.properties[rockProperties.indexOf(name)].get(cell),
  }));
}
function sampleHeights(map: PhysicalField, carry: ReliefCarry) {
  heights.forEach((name, n) => {
    const sample = physicalSampler(map.mesh, carry.before[n]);
    for (let cell = 0; cell < map.mesh.count; cell++) {
      const old = carry.old.get(cell),
        shared = map[name].get(cell);
      if (old <= 0) continue;
      const [x, y] = meshPoint(
        map.mesh,
        map.mesh.x(cell) + carry.fromX.get(cell),
        map.mesh.y(cell) + carry.fromY.get(cell)
      );
      const origin = sample(x, y);
      // Material from beyond the map's edge has no height to bring.
      if (Number.isFinite(origin)) map[name].set(cell, shared + (origin - shared) * old);
    }
  });
}
function takeRock(map: PhysicalField, carry: ReliefCarry, kinds: readonly Band[], cell: number) {
  const [x, y] = meshPoint(
      map.mesh,
      map.mesh.x(cell) + carry.fromX.get(cell),
      map.mesh.y(cell) + carry.fromY.get(cell)
    ),
    origin = map.mesh.cellAt(x, y);
  if (origin >= 0 && carry.old.get(cell) >= 0.5) {
    rockProperties.forEach((name, n) => map[name].set(cell, carry.properties[n].get(origin)));
    kinds.forEach((band, n) => band.set(cell, carry.kinds[n].get(origin)));
  }
  // Crust the plates' parting opened has no column until now: it is new sea floor.
  if (layerDepth(map, cell, 0) <= 0 && layerDepth(map, cell, 1) <= 0) newSeaFloor(map, cell);
}
function newSeaFloor(map: PhysicalField, cell: number) {
  oceanicColumn(map, cell);
  newBasaltSurface(map, cell);
}
const rockBefore = (carry: ReliefCarry) => carry.before[heights.indexOf("SurfaceRockLoad")];
/** The volume of a height band over the whole mesh. */
function volumeOf(map: PhysicalField, band: Band) {
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) total += band.get(i) * map.mesh.area(i);
  return total;
}
/** The source cells no cell took its rock from. */
function untaken(map: PhysicalField, carry: ReliefCarry) {
  const taken = workingArray(map, "int32", "carry:taken").fill(0);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (carry.old.get(cell) <= 0) continue;
    const [x, y] = meshPoint(
        map.mesh,
        map.mesh.x(cell) + carry.fromX.get(cell),
        map.mesh.y(cell) + carry.fromY.get(cell)
      ),
      origin = map.mesh.cellAt(x, y);
    if (origin >= 0) taken.set(origin, 1);
  }
  return taken;
}
/** Works out where a source's rock lands and how much of it comes back; returns all it held. */
function sendRock(
  map: PhysicalField,
  carry: ReliefCarry,
  source: number,
  landing: Band,
  volume: Band
) {
  const mesh = map.mesh,
    rock = rockBefore(carry).get(source);
  if (rock <= 0 || !Number.isFinite(carry.toX.get(source))) return 0;
  const [x, y] = meshPoint(mesh, carry.toX.get(source), carry.toY.get(source)),
    cell = mesh.cellAt(x, y),
    continent = carry.fraction.get(source) / 1000;
  if (cell < 0 || mesh.area(cell) <= 0) return 0;
  const lost = rock * mesh.area(source);
  landing.set(source, cell);
  volume.set(source, lost * (continent + (1 - continent) * arcCrustYield));
  return lost;
}
/**
 * Where plates converge some crust ends up under other crust and no cell takes up what stood on it.
 * That rock stays in the world: it rides to where its crust went and stacks on what stands there, as
 * crust squeezed out of a column goes to the belt's roots. What rode on a slab going down comes back
 * in the share a slab's crust does. Rock only moves here, so no more stacks than the move lost. A
 * stack is a thrust sheet wide, not one cell: rock rides on as sheets, so it lies across their width.
 */
function stackLostRock(map: PhysicalField, carry: ReliefCarry, lost: number, sheetWidth: number) {
  const mesh = map.mesh,
    taken = untaken(map, carry),
    landing = workingArray(map, "int32", "carry:landing").fill(-1),
    volume = workingArray(map, "float64", "carry:volume").fill(0);
  let wanted = 0;
  for (let source = 0; source < mesh.count; source++)
    if (!taken.get(source)) wanted += sendRock(map, carry, source, landing, volume);
  const share = wanted > 0 ? clamp(lost / wanted, 0, 1) : 0;
  if (share > 0) layStacks(map, carry, { landing, volume, share, sheetWidth });
  releaseWorking(map, taken, landing, volume);
}
interface Stacks {
  landing: Band;
  volume: Band;
  share: number;
  sheetWidth: number;
}
/** Each stack spreads over a sheet's width, in the rock of whatever most of it landed from. */
function layStacks(map: PhysicalField, carry: ReliefCarry, stacks: Stacks) {
  const mesh = map.mesh,
    { landing, volume, share, sheetWidth } = stacks,
    surface = carry.kinds[columnKindOffset],
    height = workingArray(map, "float64", "carry:stack").fill(0),
    largest = workingArray(map, "float64", "carry:largest").fill(0),
    top = kindBands(map)[columnKindOffset],
    kind = workingValues(map, "int32", "carry:kind", (i) => top.get(i)),
    distance = workingArray(map, "float64", "carry:distance").fill(Infinity);
  for (let source = 0; source < mesh.count; source++) {
    const cell = landing.get(source);
    if (cell < 0) continue;
    height.add(cell, (volume.get(source) * share) / mesh.area(cell));
    if (volume.get(source) <= largest.get(cell)) continue;
    largest.set(cell, volume.get(source));
    kind.set(cell, surface.get(source));
  }
  function* landed() {
    for (let cell = 0; cell < mesh.count; cell++) {
      if (largest.get(cell) <= 0) continue;
      distance.set(cell, 0);
      yield cell;
    }
  }
  metricSearch(mesh, landed(), distance, sheetWidth * 3, (target, from) =>
    kind.set(target, kind.get(from))
  );
  const spread = smoothMetric(map, height, sheetWidth);
  for (let cell = 0; cell < mesh.count; cell++)
    if (spread.get(cell) > 0) stackRock(map, cell, kind.get(cell), spread.get(cell));
  releaseWorking(map, height, largest, kind, distance, spread);
}
function stackRock(map: PhysicalField, cell: number, kind: number, metres: number) {
  const room =
      units(elevationLimit) - map.SedimentThickness.get(cell) - map.BedrockElevation.get(cell),
    rock = Math.round(Math.min(metres, Math.max(0, room)));
  shiftRock(map, cell, rock, "plates");
  layBedOfCode(map, cell, kind, rock);
  // What will not stand here goes down into the crust instead of vanishing.
  if (metres > rock)
    adjustCrustColumn(
      map,
      cell,
      map.CrustThickness.get(cell) +
        (metres - rock) * crustPerRock(map.CrustContinentalFraction.get(cell) / 1000)
    );
}
/** The move is over: every cell takes what stood where its material came from. */
export function finishReliefCarry(map: PhysicalField, carry: ReliefCarry, sheetWidth: number) {
  sampleHeights(map, carry);
  const kinds = kindBands(map),
    lost = volumeOf(map, rockBefore(carry)) - volumeOf(map, map.SurfaceRockLoad);
  for (let cell = 0; cell < map.mesh.count; cell++) takeRock(map, carry, kinds, cell);
  stackLostRock(map, carry, lost, sheetWidth);
  const { before, properties, kinds: held, ...bands } = carry;
  releaseWorking(map, ...before, ...properties, ...held, ...Object.values(bands));
}

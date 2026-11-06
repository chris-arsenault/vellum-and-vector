import type { Band } from "@atlas/domain";
import {
  columnKindOffset,
  kindBands,
  layerDepth,
  rockDepthFields,
  rockLayers,
} from "../rock/rockColumn";
import { newBasaltSurface } from "../rock/rockField";
import { oceanicColumn } from "../rock/rockHistory";
import type { PhysicalField } from "./field";
import { meshDeltaX, meshPoint } from "./mesh";
import { physicalSampler } from "./physicalMetric";
import { releaseWorking, workingArray } from "./physicalNumerics";
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
}
export function beginReliefCarry(map: PhysicalField): ReliefCarry {
  return {
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
/** A step of the move: each cell learns where what arrived in it had come from. */
export function stepReliefCarry(map: PhysicalField, plan: TransportPlan, carry: ReliefCarry) {
  const mesh = map.mesh,
    { fromX, fromY, old, nextX, nextY, nextOld } = carry;
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
/** The move is over: every cell takes what stood where its material came from. */
export function finishReliefCarry(map: PhysicalField, carry: ReliefCarry) {
  sampleHeights(map, carry);
  const kinds = kindBands(map);
  for (let cell = 0; cell < map.mesh.count; cell++) takeRock(map, carry, kinds, cell);
  const { before, properties, kinds: held, ...bands } = carry;
  releaseWorking(map, ...before, ...properties, ...held, ...Object.values(bands));
}

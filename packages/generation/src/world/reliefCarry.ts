import { CellList, type Band } from "@atlas/domain";
import {
  landCollisionPackage,
  deformGround,
  formTransportOpening,
  heldCoverDepth,
  heldPlacement,
  holdRock,
  placeCarriedGround,
  releaseHeldRock,
  type Deformation,
  type HeldRock,
} from "../rock/groundTransport";
export { heldLayers, holdRock, releaseHeldRock, type HeldRock } from "../rock/groundTransport";
import { arcCrustYield } from "../rock/crustTransport";
import type { PhysicalField } from "./field";
import { meshDeltaX, meshPoint } from "./mesh";
import { metricSearch } from "./metricSearch";
import { physicalSampler } from "./physicalMetric";
import { releaseWorking, workingArray, workingValues } from "./physicalNumerics";
import type { TransportPlan } from "./transportPlan";
import { weightScale } from "./transportPlan";

/**
 * A deformation interval carries existing relief before construction changes it. Each cell follows
 * the source coordinates of arriving material and samples the height and rock there. The next
 * interval begins from the changed ground, so newly built mountains travel with their plates.
 */
export interface ReliefCarry extends HeldRock {
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
    ...holdRock(map),
    toX: workingValues(map, "float64", "carry:toX", (i) => map.mesh.x(i)),
    toY: workingValues(map, "float64", "carry:toY", (i) => map.mesh.y(i)),
    fraction: map.coverage.copyBand(map.CrustContinentalFraction),
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
/** Least-squares local deformation of the material coordinates, rather than a rotation by speed. */
export function carriedDeformation(
  map: PhysicalField,
  carry: Pick<ReliefCarry, "toX" | "toY">,
  source: number
): Deformation {
  let xx = 0,
    xy = 0,
    yy = 0,
    ax = 0,
    ay = 0,
    bx = 0,
    by = 0;
  for (let edge = 0; edge < map.mesh.degree(source); edge++) {
    const j = map.mesh.neighbor(source, edge);
    if (j < 0 || !Number.isFinite(carry.toX.get(j))) continue;
    const x = meshDeltaX(map.mesh, map.mesh.x(j) - map.mesh.x(source)),
      y = map.mesh.y(j) - map.mesh.y(source),
      dx = meshDeltaX(map.mesh, carry.toX.get(j) - carry.toX.get(source)),
      dy = carry.toY.get(j) - carry.toY.get(source),
      w = 1 / Math.max(1, x * x + y * y);
    xx += x * x * w;
    xy += x * y * w;
    yy += y * y * w;
    ax += dx * x * w;
    ay += dx * y * w;
    bx += dy * x * w;
    by += dy * y * w;
  }
  const determinant = xx * yy - xy * xy;
  return determinant > 1e-12
    ? [
        (ax * yy - ay * xy) / determinant,
        (ay * xx - ax * xy) / determinant,
        (bx * yy - by * xy) / determinant,
        (by * xx - bx * xy) / determinant,
      ]
    : [1, 0, 0, 1];
}
function placeArrivals(map: PhysicalField, carry: ReliefCarry, taken: Band) {
  const samples = carry.before.map((band) => physicalSampler(map.mesh, band));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const [x, y] = meshPoint(
        map.mesh,
        map.mesh.x(cell) + carry.fromX.get(cell),
        map.mesh.y(cell) + carry.fromY.get(cell)
      ),
      origin = map.mesh.cellAt(x, y);
    if (origin < 0 || carry.old.get(cell) < 0.5) {
      formTransportOpening(map, cell);
      continue;
    }
    taken.set(origin, 1);
    placeCarriedGround(
      map,
      carry,
      cell,
      origin,
      samples.map((sample, n) => {
        const value = sample(x, y);
        return Number.isFinite(value) ? value : carry.before[n].get(origin);
      })
    );
    deformGround(map, cell, carriedDeformation(map, carry, origin));
  }
}
interface Footprint {
  distance: Band;
  marked: Band;
  cells: CellList;
}
function landingFootprint(map: PhysicalField, at: number, width: number, work: Footprint) {
  const { distance, marked, cells } = work;
  cells.clear();
  cells.push(at);
  marked.set(at, 1);
  distance.set(at, 0);
  metricSearch(map.mesh, [at], distance, width * 3, (target) => {
    if (!marked.get(target)) {
      marked.set(target, 1);
      cells.push(target);
    }
  });
  let weight = 0;
  for (let n = 0; n < cells.length; n++)
    weight +=
      Math.exp(-distance.get(cells.at(n)) / Math.max(1, width)) * map.mesh.area(cells.at(n));
  return weight;
}
function stackDonor(
  map: PhysicalField,
  carry: ReliefCarry,
  source: number,
  width: number,
  work: Footprint
) {
  const rock = Math.max(0, heldPlacement(carry, "SurfaceRockLoad", source));
  if (rock <= 0 && heldCoverDepth(carry, source) <= 0) return;
  if (!Number.isFinite(carry.toX.get(source))) return;
  const [x, y] = meshPoint(map.mesh, carry.toX.get(source), carry.toY.get(source)),
    at = map.mesh.cellAt(x, y);
  if (at < 0) return;
  const weight = landingFootprint(map, at, width, work),
    continent = carry.fraction.get(source) / 1000,
    arrivedArea = map.mesh.area(source) * (continent + (1 - continent) * arcCrustYield),
    f = carriedDeformation(map, carry, source);
  for (let n = 0; n < work.cells.length; n++) {
    const target = work.cells.at(n),
      ratio = (arrivedArea * Math.exp(-work.distance.get(target) / Math.max(1, width))) / weight;
    landCollisionPackage(map, carry, target, source, ratio, f);
    work.distance.set(target, Infinity);
    work.marked.set(target, 0);
  }
}
/** Each displaced donor carries its own beds through spreading; donors are never painted as one kind. */
function stackLostRock(map: PhysicalField, carry: ReliefCarry, taken: Band, width: number) {
  const work: Footprint = {
    distance: workingArray(map, "float64", "carry:distance").fill(Infinity),
    marked: workingArray(map, "uint8", "carry:marked").fill(0),
    cells: new CellList(),
  };
  for (let source = 0; source < map.mesh.count; source++)
    if (!taken.get(source)) stackDonor(map, carry, source, width, work);
  releaseWorking(map, work.distance, work.marked);
}
/** Settle placement and complete material packages before another process sees the moved ground. */
export function finishReliefCarry(map: PhysicalField, carry: ReliefCarry, sheetWidth: number) {
  const taken = workingArray(map, "uint8", "carry:taken").fill(0);
  placeArrivals(map, carry, taken);
  stackLostRock(map, carry, taken, sheetWidth);
  releaseHeldRock(map, carry);
  releaseWorking(
    map,
    taken,
    carry.fromX,
    carry.fromY,
    carry.old,
    carry.nextX,
    carry.nextY,
    carry.nextOld,
    carry.toX,
    carry.toY,
    carry.fraction
  );
}

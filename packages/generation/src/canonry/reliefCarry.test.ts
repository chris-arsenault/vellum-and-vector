import { expect, it } from "vitest";
import { createField, type PhysicalField } from "./field";
import { createMesh } from "./mesh";
import { workingArray } from "./physicalNumerics";
import { beginReliefCarry, finishReliefCarry, stepReliefCarry } from "./reliefCarry";
import { weightScale, type TransportPlan } from "./transportPlan";
import { createWorldMesh } from "./worldMesh";

/** A plan moving a share of each cell to its next neighbour along x, on a row of the mesh. */
function driftPlan(map: PhysicalField, share: number): TransportPlan {
  const count = map.mesh.count,
    offsets = workingArray(map, "int32", "test:offsets", count + 1),
    targets = workingArray(map, "int32", "test:targets", count * 2),
    weights = workingArray(map, "float64", "test:weights", count * 2),
    arrivals = workingArray(map, "float64", "test:arrivals").fill(0),
    dominant = workingArray(map, "int32", "test:dominant").fill(-1),
    dominantWeight = workingArray(map, "float64", "test:dominantWeight").fill(0);
  const eastOf = (i: number) => {
    const east = map.mesh.cellAt(map.mesh.x(i) + map.mesh.spacing, map.mesh.y(i));
    return east >= 0 && map.mesh.area(east) === map.mesh.area(i) ? east : -1;
  };
  for (let i = 0; i < count; i++) {
    offsets.set(i, i * 2);
    const east = eastOf(i);
    targets.set(i * 2, i);
    weights.set(i * 2, (1 - share) * weightScale);
    targets.set(i * 2 + 1, east);
    weights.set(i * 2 + 1, share * weightScale);
    arrivals.add(i, (1 - share) * weightScale);
    if (east >= 0) arrivals.add(east, share * weightScale);
  }
  offsets.set(count, count * 2);
  return { offsets, targets, weights, arrivals, dominant, dominantWeight };
}

/** Everything west of a line moves one cell east onto the crust just past it, which stays put. */
function collisionPlan(map: PhysicalField, line: number): TransportPlan {
  const count = map.mesh.count,
    offsets = workingArray(map, "int32", "test:offsets", count + 1),
    targets = workingArray(map, "int32", "test:targets", count),
    weights = workingArray(map, "float64", "test:weights", count),
    arrivals = workingArray(map, "float64", "test:arrivals").fill(0),
    dominant = workingArray(map, "int32", "test:dominant").fill(-1),
    dominantWeight = workingArray(map, "float64", "test:dominantWeight").fill(0);
  for (let i = 0; i < count; i++) {
    offsets.set(i, i);
    const east = map.mesh.cellAt(map.mesh.x(i) + map.mesh.spacing, map.mesh.y(i)),
      target = map.mesh.x(i) <= line && east >= 0 ? east : i;
    targets.set(i, target);
    weights.set(i, weightScale);
    arrivals.add(target, weightScale);
  }
  offsets.set(count, count);
  return { offsets, targets, weights, arrivals, dominant, dominantWeight };
}
const worldMesh = () => createWorldMesh([0, 0, 6000, 6000], 36, 0);
function collidingRock(fraction: number, sheetWidth: number, rockWidth = 3) {
  const map = createField(worldMesh()),
    line = map.mesh.x(Math.floor(map.mesh.count / 2));
  map.CrustContinentalFraction.fill(fraction);
  // Rock on both sides of the line, so what stacks shows against what stood there.
  for (let i = 0; i < map.mesh.count; i++)
    if (Math.abs(map.mesh.x(i) - line) <= map.mesh.spacing * rockWidth) {
      map.SurfaceRockLoad.set(i, 1000 * 1024);
      map.BedrockElevation.set(i, 1000 * 1024);
      map.RockLayerDepth0.set(i, 1000 * 1024);
    }
  const volume = () => {
    let total = 0;
    for (let i = 0; i < map.mesh.count; i++) total += map.SurfaceRockLoad.get(i) * map.mesh.area(i);
    return total;
  };
  const was = volume(),
    carry = beginReliefCarry(map),
    plan = collisionPlan(map, line);
  stepReliefCarry(map, plan, carry);
  // Without stacking, the row of crust that went under would be gone with its rock.
  finishReliefCarry(map, carry, sheetWidth);
  const peak = Math.max(
    ...Array.from({ length: map.mesh.count }, (_, i) => map.SurfaceRockLoad.get(i))
  );
  return { was, now: volume(), peak: peak / 1024 };
}
const onePlaceWidth = worldMesh().spacing * 1.5;

it("stacks the rock of crust that goes under where that crust went", () => {
  const { was, now, peak } = collidingRock(1000, onePlaceWidth);
  expect(now / was).toBeGreaterThan(0.97);
  expect(now / was).toBeLessThanOrEqual(1.0001);
  expect(peak).toBeGreaterThan(1000);
});

it("lays a stack across a sheet's width, not in a line of spikes", () => {
  const spacing = worldMesh().spacing,
    narrow = collidingRock(1000, onePlaceWidth),
    wide = collidingRock(1000, spacing * 4);
  expect(wide.peak).toBeLessThan(narrow.peak);
  expect(wide.now / wide.was).toBeGreaterThan(0.97);
});

it("brings back part of what rode on a slab going down, and makes no rock", () => {
  const land = collidingRock(1000, onePlaceWidth),
    ocean = collidingRock(0, onePlaceWidth);
  expect(ocean.now).toBeLessThan(land.now);
  expect(ocean.now).toBeGreaterThan(0);
  expect(land.now / land.was).toBeLessThanOrEqual(1.0001);
});

it("carries a ridge whole across many small steps instead of planing it down", () => {
  const map = createField(createMesh(32, 1));
  const middle = Math.floor(map.mesh.count / 2),
    ridgeX = map.mesh.x(middle);
  for (let i = 0; i < map.mesh.count; i++)
    map.BedrockElevation.set(i, map.mesh.x(i) === ridgeX ? 5000 : 0);
  const peak = () =>
    Math.max(...Array.from({ length: map.mesh.count }, (_, i) => map.BedrockElevation.get(i)));
  const carry = beginReliefCarry(map),
    plan = driftPlan(map, 0.25);
  for (let step = 0; step < 4; step++) stepReliefCarry(map, plan, carry);
  finishReliefCarry(map, carry, onePlaceWidth);
  expect(peak()).toBeGreaterThan(4500);
  // The whole move was about one cell east, and the ridge went with it.
  const at = map.mesh.cellAt(ridgeX + map.mesh.spacing, map.mesh.y(middle));
  expect(map.BedrockElevation.get(at)).toBeGreaterThan(map.BedrockElevation.get(middle));
});

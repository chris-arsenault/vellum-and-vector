import { expect, it } from "vitest";
import { createField, type PhysicalField } from "./field";
import { createMesh } from "./mesh";
import { workingArray } from "./physicalNumerics";
import { beginReliefCarry, finishReliefCarry, stepReliefCarry } from "./reliefCarry";
import { weightScale, type TransportPlan } from "./transportPlan";

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
  finishReliefCarry(map, carry);
  expect(peak()).toBeGreaterThan(4500);
  // The whole move was about one cell east, and the ridge went with it.
  const at = map.mesh.cellAt(ridgeX + map.mesh.spacing, map.mesh.y(middle));
  expect(map.BedrockElevation.get(at)).toBeGreaterThan(map.BedrockElevation.get(middle));
});

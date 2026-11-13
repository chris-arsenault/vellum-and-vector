import { expect, it } from "vitest";
import { createTestField, type TestPhysicalField } from "../rock/groundTestFixture";
import { setLayer } from "../rock/rockColumn";
import { projectGround } from "../rock/groundShares";
import { rockCatalogue } from "../rock/rockCatalogue";
import { createWorldMesh } from "../world/worldMesh";
import { physicalContext } from "../world/context";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { units } from "../world/math";
import { resolveLandTargets } from "./flowGuidance";
import { addReach } from "./reachEvolution";
import { directionalResponsesFrom } from "./routingMaterial";
import { releaseWorking } from "../world/physicalNumerics";
import { respond } from "../coupling/answers";
import { invalidateProcesses } from "../processOperation";
import { groundOf } from "../rock/ground";
import { drainageConditioning } from "./drainageFlood";

respond({
  key: "rootHold",
  by: "explicit routing contract roots",
  reads: ["TreeCover"],
  base: (map, cell) => map.TreeCover.get(cell),
});

function suppliedJunction() {
  const map = createTestField(createWorldMesh([-1000, -1000, 1000, 1000], 64, 0)),
    source = map.mesh.addressCell(0, 0, false),
    neighbors = Array.from({ length: map.mesh.degree(source) }, (_, edge) =>
      map.mesh.neighbor(source, edge)
    );
  expect(neighbors).not.toContain(-1);
  map.WaterKindCodes.fill(1);
  map.BedrockElevation.fill(units(100));
  map.Elevation.fill(units(100));
  map.DrainageElevations.fill(units(100));
  map.DrainageRanks.fill(0);
  for (const cell of [source, ...neighbors]) map.WaterKindCodes.set(cell, 0);
  map.DrainageRanks.set(source, 3);
  map.DrainageRanks.set(neighbors[0], 2);
  map.DrainageRanks.set(neighbors[1], 2);
  map.DrainageRanks.set(neighbors[2], 4);
  const profile = atlasPhysicalProfile({}, {}, map.scale);
  profile.DrainageCaptureWeight = 0;
  profile.DrainageOutletAlignmentWeight = 0;
  const context = physicalContext(0, 0, profile);
  return { map, source, neighbors, context };
}

/** Explicit bed fabric and signed dip favor one of two otherwise equal legal faces. */
function favor(map: TestPhysicalField, source: number, toward: number) {
  const dx = map.mesh.x(toward) - map.mesh.x(source),
    dy = map.mesh.y(toward) - map.mesh.y(source),
    length = Math.hypot(dx, dy);
  setLayer(map, source, 0, rockCatalogue.shale.code, units(10), {
    grainX: (1000 * (dx * dx - dy * dy)) / length ** 2,
    grainY: (2000 * dx * dy) / length ** 2,
    bedSlopeX: -dx / length,
    bedSlopeY: -dy / length,
  });
  projectGround(map, source);
}

function selected(input: ReturnType<typeof suppliedJunction>) {
  const targets = resolveLandTargets(input.map, input.context),
    result = targets.get(input.source);
  releaseWorking(input.map, targets);
  return result;
}

it("uses actual bed fabric to choose between equal legal routes without an inherited cut", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left, right],
    } = input;
  expect(map.GroundCutShare.get(source)).toBe(0);
  favor(map, source, left);
  expect(directionalResponsesFrom(map, source, input.context)(left)).toBeGreaterThan(
    directionalResponsesFrom(map, source, input.context)(right)
  );
  expect(selected(input)).toBe(left);
  favor(map, source, right);
  expect(selected(input)).toBe(right);
  expect(map.GroundCutShare.get(source)).toBe(0);
});

it("keeps rank legality ahead of a more yielding face", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left, right],
    } = input;
  favor(map, source, left);
  map.DrainageRanks.set(left, 4);
  expect(selected(input)).toBe(right);
});

it("preserves the existing rank score ahead of material preference", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left, right],
    } = input;
  favor(map, source, left);
  map.DrainageRanks.set(right, 1);
  expect(selected(input)).toBe(right);
});

it("uses directional material for equal-height flood corridors without altering their level", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left, right],
    } = input;
  map.WaterKindCodes.fill(1);
  map.WaterKindCodes.set(source, 0);
  favor(map, source, left);
  drainageConditioning(map, input.context);
  expect(map.DrainageParents.get(source)).toBe(left);
  expect(map.DrainageElevations.get(source)).toBe(units(100));
  favor(map, source, right);
  drainageConditioning(map, input.context);
  expect(map.DrainageParents.get(source)).toBe(right);
});

it("lets material influence the existing legal downhill bracket on an uncut slope", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left, right, uphill],
    } = input;
  for (const cell of [left, right]) {
    map.BedrockElevation.set(cell, units(90));
    map.Elevation.set(cell, units(90));
    map.DrainageElevations.set(cell, units(90));
  }
  map.BedrockElevation.set(uphill, units(110));
  map.Elevation.set(uphill, units(110));
  map.DrainageElevations.set(uphill, units(110));
  const choices = (toward: number) => {
    favor(map, source, toward);
    return Array.from({ length: 32 }, (_, draw) => {
      input.context.EpochStableSeed = draw;
      return selected(input);
    });
  };
  const leftPreferred = choices(left),
    rightPreferred = choices(right);
  expect([...leftPreferred, ...rightPreferred].every((cell) => [left, right].includes(cell))).toBe(
    true
  );
  expect(leftPreferred.some((cell, at) => cell !== rightPreferred[at])).toBe(true);
  leftPreferred.forEach((cell, at) => {
    if (cell !== rightPreferred[at]) {
      expect(cell).toBe(left);
      expect(rightPreferred[at]).toBe(right);
    }
  });
});

it("refreshes current root answers instead of borrowing a preceding stage's held roots", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left],
    } = input;
  favor(map, source, left);
  groundOf(map).heldBy({ get: () => 100 });
  const bare = directionalResponsesFrom(map, source, input.context)(left);
  groundOf(map).heldBy({ get: () => 0 });
  expect(directionalResponsesFrom(map, source, input.context)(left)).toBe(bare);
  map.TreeCover.set(source, 1);
  invalidateProcesses(map);
  expect(directionalResponsesFrom(map, source, input.context)(left)).toBeLessThan(bare);
});

it("keeps a viable retained course ahead of a newly preferred material route", () => {
  const input = suppliedJunction(),
    {
      map,
      source,
      neighbors: [left, right],
    } = input;
  favor(map, source, left);
  expect(selected(input)).toBe(left);
  addReach(map.rivers, [source, right]);
  expect(selected(input)).toBe(right);
});

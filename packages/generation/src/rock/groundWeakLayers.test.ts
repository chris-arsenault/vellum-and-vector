import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { groundOf } from "./ground";
import { setLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { yieldingPlane, seamContinuity, detachmentSpread } from "./groundQueries";
import { units } from "../world/math";
import { removeRock } from "./groundLedger";
import { openCut } from "./groundShares";
import { inheritedDetachment } from "./groundWeakLayers";

it("distinguishes a buried connected seam from displaced intervals and an eroded seam", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (const cell of [0, 1]) {
    setLayer(map, cell, 0, rocks.quartzite.code, units(20));
    setLayer(map, cell, 1, rocks.saltbed.code, units(2));
    setLayer(map, cell, 2, rocks.granite.code, units(100));
  }
  const query = yieldingPlane(),
    a = groundOf(map).fold(0, query),
    b = groundOf(map).fold(1, query);
  expect(a.kind).toBe(rocks.saltbed.code);
  expect(a.overburden).toBe(units(20));
  expect(a.thickness).toBe(units(2));
  expect(seamContinuity(a, b, 0, units(50), 0)).toBe(1);
  expect(seamContinuity(a, b, units(10), units(50), 0)).toBe(0);
  expect(detachmentSpread(a, 1)).toBeGreaterThan(0);
  expect(detachmentSpread(a, 0)).toBe(0);
  removeRock(map, 0, units(22), "explicit cut");
  const eroded = groundOf(map).fold(0, query);
  expect(eroded.kind).not.toBe(rocks.saltbed.code);
  expect(seamContinuity(eroded, b, 0, units(50), 0)).toBe(0);
});

it("does not turn unrelated facet beds into a continuous buried surface material", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    setLayer(map, cell, 0, rocks.saltbed.code, units(10));
    setLayer(map, cell, 1, rocks.granite.code, units(100));
    openCut(map, cell, 0.2);
    setLayer(
      map,
      cell,
      1,
      cell === 0 ? rocks.gneiss.code : rocks.slate.code,
      units(10),
      { strength: 100 },
      "cut"
    );
    setLayer(map, cell, 2, rocks.granite.code, units(100), {}, "cut");
  }
  const ground = groundOf(map),
    query = yieldingPlane(undefined, "retained"),
    neighbor = map.mesh.neighbor(0, 0);
  expect(ground.fold(0, query, "land").overburden).toBe(0);
  expect(ground.fold(0, query, "cut").kind).toBe(rocks.gneiss.code);
  expect(detachmentSpread(ground.fold(0, query), 1)).toBeGreaterThan(0);
  expect(inheritedDetachment(map, 0)).toBe(0);
  setLayer(map, neighbor, 1, rocks.gneiss.code, units(10), { strength: 100 }, "cut");
  expect(inheritedDetachment(map, 0)).toBeGreaterThan(0);
  map.GroundCutDepth.set(neighbor, units(100));
  expect(inheritedDetachment(map, 0)).toBe(0);
});

it("distinguishes an unbounded basement marker from an equally thin finite retained bed", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    ground = groundOf(map),
    finite = yieldingPlane(undefined, "retained");
  for (let cell = 0; cell < map.mesh.count; cell++) {
    setLayer(map, cell, 0, rocks.quartzite.code, units(20));
    setLayer(map, cell, 1, rocks.saltbed.code, 1);
  }
  expect(ground.fold(0, yieldingPlane()).kind).toBe(rocks.saltbed.code);
  expect(ground.fold(0, finite).kind).toBe(rocks.quartzite.code);
  expect(inheritedDetachment(map, 0)).toBe(0);
  for (let cell = 0; cell < map.mesh.count; cell++)
    setLayer(map, cell, 2, rocks.granite.code, units(100));
  expect(ground.fold(0, finite).kind).toBe(rocks.saltbed.code);
  expect(ground.fold(0, finite).thickness).toBe(1);
  expect(inheritedDetachment(map, 0)).toBeGreaterThan(0);
});

it("connects unequal inclined intervals only where their actual depths overlap", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (const cell of [0, 1]) {
    setLayer(map, cell, 0, rocks.quartzite.code, units(20));
    setLayer(map, cell, 1, rocks.saltbed.code, units(cell === 0 ? 2 : 100));
    setLayer(map, cell, 2, rocks.granite.code, units(100));
  }
  const query = yieldingPlane(undefined, "detachment"),
    a = groundOf(map).fold(0, query),
    b = groundOf(map).fold(1, query);
  expect(seamContinuity(a, b, units(-10), 0, 0)).toBe(0);
  expect(seamContinuity(a, b, units(75), 0, 0)).toBeGreaterThan(0);
  expect(seamContinuity(a, b, units(75), 0, 0)).toBe(seamContinuity(b, a, units(-75), 0, 0));
  expect(seamContinuity(a, { ...b, slopeX: 2 }, units(75), units(85), 0)).toBe(0);
});

it("selects a buried detachment beneath a stronger cap despite a weaker exposed bed", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    ground = groundOf(map);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    setLayer(map, cell, 0, rocks.saltbed.code, units(1), { strength: 10 });
    setLayer(map, cell, 1, rocks.quartzite.code, units(20));
    setLayer(map, cell, 2, rocks.shale.code, units(2));
    setLayer(map, cell, 3, rocks.granite.code, units(100));
  }
  expect(ground.fold(0, yieldingPlane(undefined, "retained")).overburden).toBe(0);
  const plane = ground.fold(0, yieldingPlane(undefined, "detachment"));
  expect(plane.kind).toBe(rocks.shale.code);
  expect(plane.overburden).toBe(units(21));
  expect(plane.capStrength).toBeGreaterThan(plane.strength);
  expect(inheritedDetachment(map, 0)).toBeGreaterThan(0);
});

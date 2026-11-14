import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { cargoIdentity } from "./groundCargoIdentity";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { readLayer, setLayer } from "./rockColumn";
import { projectGround } from "./groundShares";
import { captureContactBeds, realizeContacts } from "./contactRealization";

it("keeps the captured beds available after a provisional exposure changes the first cell", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, units(100));
  setLayer(map, 0, 0, rocks.quartzite.code, units(20), { formedMin: 2 });
  setLayer(map, 0, 1, rocks.shale.code, units(1000), { formedMin: 1 });
  projectGround(map, 0);
  const beds = captureContactBeds(map, 0);
  setLayer(map, 0, 0, rocks.shale.code, units(1000));
  realizeContacts(
    map,
    [0],
    {
      x: map.mesh.x(0) + map.mesh.origin[0],
      y: map.mesh.y(0) + map.mesh.origin[1],
      land: units(100),
      cut: units(100),
    },
    beds
  );
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rocks.quartzite.code, formedMin: 2 });
});

it("exposes the lower bed across an inclined contact while retaining the cap's history and hosted density", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 32, 0)),
    cells = Array.from({ length: map.mesh.count }, (_, cell) => cell),
    key = cargoIdentity(map, "supplied-charge"),
    cargo = new Float64Array([key, rocks.quartzite.code, 4]);
  for (const cell of cells) {
    map.BedrockElevation.set(cell, units(100));
    setLayer(map, cell, 0, rocks.quartzite.code, units(20), {
      bedSlopeX: 0.3,
      grainX: -1000,
      formedMin: 2,
      formedMax: 2,
      cargo,
    });
    setLayer(map, cell, 1, rocks.shale.code, units(1000), { formedMin: 1, formedMax: 1 });
    projectGround(map, cell);
  }
  realizeContacts(map, cells, {
    x: map.mesh.origin[0],
    y: map.mesh.origin[1],
    land: units(100),
    cut: units(100),
  });
  const left = cells.find((cell) => map.mesh.x(cell) < -200)!,
    right = cells.find((cell) => map.mesh.x(cell) > 200)!;
  expect(readLayer(map, left, 0)).toMatchObject({
    kind: rocks.quartzite.code,
    formedMin: 2,
    grainX: -1000,
    bedSlopeX: 0.3,
  });
  expect(readLayer(map, left, 0).cargo).toEqual(cargo);
  expect(readLayer(map, right, 0).kind).toBe(rocks.shale.code);
});

it("resolves an inclined donor contact in the child's longitude chart", () => {
  const mesh = createWorldMesh(
      [800, 100, 1200, 300],
      32,
      0,
      () => true,
      80000,
      undefined,
      false,
      false,
      1000
    ),
    map = createTestField(mesh),
    cells = Array.from({ length: mesh.count }, (_, cell) => cell);
  for (const cell of cells) {
    map.BedrockElevation.set(cell, units(100));
    setLayer(map, cell, 0, rocks.quartzite.code, units(20), { bedSlopeX: 0.3 });
    setLayer(map, cell, 1, rocks.shale.code, units(1000));
    projectGround(map, cell);
  }
  // Source longitude zero is the child's central longitude, represented here as 1000.
  realizeContacts(map, cells, { x: 0, y: 200, land: units(100), cut: units(100) });
  const west = cells.find((cell) => mesh.x(cell) < -100)!,
    east = cells.find((cell) => mesh.x(cell) > 100)!;
  expect(readLayer(map, west, 0).kind).toBe(rocks.quartzite.code);
  expect(readLayer(map, east, 0).kind).toBe(rocks.shale.code);
});

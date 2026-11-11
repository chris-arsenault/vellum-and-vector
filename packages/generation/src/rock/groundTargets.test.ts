import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { loadOf } from "./groundLoad";
import { projectGround } from "./groundShares";
import { realizeGroundTarget } from "./groundTargets";
import { erode } from "./groundLedger";
import { meltIce } from "./groundSurfaceMedia";

it("a place deposit requires actual carried material and retains its identity", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  const target = { add: 50, atMost: Infinity, atLeast: -Infinity };
  realizeGroundTarget(map, "SedimentThickness", 0, target);
  expect(map.SedimentThickness.get(0)).toBe(0);
  loadOf(map).add(0, materialLayer(rockCatalogue.basalt.code, map.mesh.area(0), { formedMin: 3 }));
  realizeGroundTarget(map, "SedimentThickness", 0, target);
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rockCatalogue.basalt.code,
    formedMin: 3,
  });
});

it("a lower surface request excavates the reached bed rather than translating its column", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, 10_000);
  setLayer(map, 0, 0, rockCatalogue.sandstone.code, 700, { formedMin: 2 });
  projectGround(map, 0);
  realizeGroundTarget(map, "Elevation", 0, { add: 0, atMost: 9_800, atLeast: -Infinity });
  expect(readLayer(map, 0, 0).depth).toBeLessThan(700);
  expect(loadOf(map).get(0)).toMatchObject({ kind: rockCatalogue.sandstone.code, formedMin: 2 });
});

it("repeated or ended additive requests preserve intervening erosion and its surviving material", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, 10_000);
  setLayer(map, 0, 0, rockCatalogue.sandstone.code, 700, { formedMin: 2 });
  projectGround(map, 0);
  const request = { add: -100, atMost: Infinity, atLeast: -Infinity };
  realizeGroundTarget(map, "Elevation", 0, request);
  erode(map, 0, 200, "test");
  const worn = map.Elevation.get(0),
    surviving = readLayer(map, 0, 0).depth;
  realizeGroundTarget(map, "Elevation", 0, request);
  realizeGroundTarget(map, "Elevation", 0, { ...request, add: 0 });
  expect(map.Elevation.get(0)).toBe(worn);
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rockCatalogue.sandstone.code,
    depth: surviving,
    formedMin: 2,
  });
});

it("a place melts available ice into retained water and cannot restore it when its effect ends", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    request = { add: -0.5, atMost: Infinity, atLeast: -Infinity };
  map.IceThickness.set(0, 2);
  realizeGroundTarget(map, "IceThickness", 0, request);
  expect(map.IceThickness.get(0)).toBe(1.5);
  expect(map.ExternalMeltwater.get(0)).toBe(500);
  meltIce(map, 0, 0.5, "test", true);
  realizeGroundTarget(map, "IceThickness", 0, request);
  realizeGroundTarget(map, "IceThickness", 0, { ...request, add: 0 });
  expect(map.IceThickness.get(0)).toBe(1);
});

it("stripping ecological soil skin leaves its actual substrate and history in the column", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rockCatalogue.sandstone.code, 700, { formedMin: 2 });
  map.SoilDepth.set(0, 1);
  realizeGroundTarget(map, "SoilDepth", 0, { add: 0, atMost: 0.25, atLeast: -Infinity });
  expect(map.SoilDepth.get(0)).toBe(0.25);
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rockCatalogue.sandstone.code,
    depth: 700,
    formedMin: 2,
  });
});

import { expect, it } from "vitest";
import { rectangle, spatial, type FieldGeography, type NumericalResource } from "@atlas/domain";
import { fixture, scope } from "./catalogFixture";

function body(x: number): NonNullable<FieldGeography["waterBodies"]>[number] {
  return {
    id: String(x),
    footprint: rectangle([x, 600, x + 100, 700]),
    slices: [
      { floor: 10, area: 100, footprint: rectangle([x + 10, 610, x + 20, 620]), sediment: 2 },
    ],
    volume: 1000,
    spill: 12,
    outlet: null,
    outletFrom: null,
    suspended: 3,
    fixedLevel: null,
    outletPath: null,
  };
}

it("reads only intersecting geography parts while retaining local water data and immutable source geography", async () => {
  const catalog = await fixture();
  const resource: NumericalResource = {
    schemaVersion: 1,
    id: "layout",
    revision: 1,
    scope,
    crsId: "metres",
    bounds: [0, 0, 1000, 1000],
    precision: 1e-6,
    layout: "regular",
    state: "ready",
    arrays: [],
    partitions: [],
  };
  const geography: FieldGeography = {
    id: resource.id,
    scope,
    ocean: {
      type: "MultiPolygon",
      coordinates: [
        (rectangle([0, 0, 100, 200]) as import("geojson").Polygon).coordinates,
        (rectangle([300, 300, 500, 500]) as import("geojson").Polygon).coordinates,
      ],
    },
    lakes: [100, 600].map((x) => ({ id: String(x), geometry: body(x).footprint, level: 12 })),
    waterBodies: [body(100), body(600)],
  };
  await catalog.commit({
    operationId: "geography",
    worldId: scope.worldId,
    expected: [],
    writes: [],
    removes: [],
    resources: [resource],
    geography: [geography],
  });
  const restored = await catalog.readFieldGeography(scope, "layout");
  const window = await catalog.readFieldWindow(scope, "layout", [0, 0, 300, 800], 10);
  expect(window.lakes?.map((lake) => lake.id)).toEqual(["100"]);
  expect(spatial.area(window.lakes![0].geometry)).toBe(10000);
  expect(spatial.area(window.ocean!)).toBe(20000);
  expect(await catalog.readFieldWindow(scope, "layout", [0, 0, 300, 800], 10)).toEqual(window);
  const local = await catalog.readFieldGeography(scope, "layout", [0, 0, 200, 250]);
  expect(spatial.area(local.ocean!)).toBe(20_000);
  expect(spatial.bounds(local.ocean!)).toEqual([0, 0, 100, 200]);
  expect(local.lakes).toEqual([]);
  expect(local.waterBodies).toEqual([]);
  const inland = await catalog.readFieldGeography(scope, "layout", [605, 605, 625, 625]);
  expect(inland.ocean).toBeNull();
  expect(inland.waterBodies).toEqual([restored.waterBodies![1]]);
  expect(inland.lakes).toEqual([restored.lakes![1]]);
  expect(await catalog.readFieldGeography(scope, "layout")).toEqual(restored);
});

import { expect, it, vi } from "vitest";
import { createField } from "../world/field";
import { createWorldMesh } from "../world/worldMesh";
import { flowRecord } from "./flows";
import { Stage } from "./stage";

function field() {
  const map = createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0));
  map.BedrockElevation.fill(100 * 1024);
  map.Elevation.fill(100 * 1024);
  return map;
}
function cover(map: ReturnType<typeof field>, cell: number, metres: number) {
  map.SedimentThickness.set(cell, metres * 1024);
  map.Elevation.set(cell, (100 + metres) * 1024);
}
const river = { id: "river", remembers: "CumulativeFluvialErosion" } as const;

it("lands each source's grant at its own destination, leaving unrelated routes alone", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  cover(map, 0, 1);
  cover(map, 1, 1);
  stage.moveLoose(0, 2, map.mesh.area(0), "transport");
  stage.moveLoose(1, 3, map.mesh.area(1), "transport");
  stage.demand("loose", "load", 0, 1024, "competitor");
  stage.settle();
  expect(map.SedimentThickness.get(2)).toBeCloseTo((512 * map.mesh.area(0)) / map.mesh.area(2));
  expect(map.SedimentThickness.get(3)).toBeCloseTo((1024 * map.mesh.area(1)) / map.mesh.area(3));
});

it("keeps loose transport off rock when surface wear competes for its cover", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  cover(map, 0, 10);
  stage.wear(river, 0, 20 * 1024);
  stage.moveLoose(0, 1, 10 * map.mesh.area(0), "creep");
  stage.settle();
  expect(
    flowRecord(map)
      .filter(({ cause }) => cause === "creep")
      .map(({ from, to }) => [from, to])
  ).toEqual(
    expect.arrayContaining([
      ["loose", "load"],
      ["load", "loose"],
    ])
  );
  expect(flowRecord(map).some(({ cause, from }) => cause === "creep" && from === "rock")).toBe(
    false
  );
});

it("splits surface removal after collecting every outgoing route from the source", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: false });
  cover(map, 0, 1);
  stage.moveSurface(0, 1, map.mesh.area(0), "slope");
  stage.moveSurface(0, 2, map.mesh.area(0), "slope");
  stage.settle();
  expect(map.SedimentThickness.get(1)).toBeCloseTo((1024 * map.mesh.area(0)) / map.mesh.area(1));
  expect(map.SedimentThickness.get(2)).toBeCloseTo((1024 * map.mesh.area(0)) / map.mesh.area(2));
  expect(map.BedrockElevation.get(0)).toBeLessThan(100 * 1024);
});

it("converts routed volume using the destination's area", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  cover(map, 0, 2);
  const area = vi.spyOn(map.mesh, "area").mockImplementation((cell) => (cell === 0 ? 10 : 20));
  try {
    stage.moveLoose(0, 1, 10, "transport");
    stage.settle();
    expect(map.SedimentThickness.get(1)).toBe(512);
  } finally {
    area.mockRestore();
  }
});

it("publishes standalone withdrawals to carriers without forwarding already routed material", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  cover(map, 0, 2);
  cover(map, 1, 2);
  stage.demand("loose", "load", 0, 1024, "withdrawal");
  stage.moveLoose(1, 2, map.mesh.area(1), "transport");
  stage.settle();
  expect(map.SedimentSupply.get(0)).toBe(1024);
  expect(map.SedimentSupply.get(1)).toBe(0);
  expect(map.SedimentSupply.get(2)).toBe(0);
});

it("does not give a later constrained removal an earlier ice removal's permission", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: false });
  map.BedrockElevation.fill(2 * 1024);
  map.Elevation.fill(2 * 1024);
  stage.wear(
    { id: "ice", remembers: "CumulativeGlacialErosion", pastBaseLevel: true },
    0,
    4 * 1024
  );
  stage.wear(river, 0, 1024);
  stage.settle();
  expect(map.CumulativeFluvialErosion.get(0)).toBe(0);
});

it("treats soil as the skin of removed substrate, never as another independent supply", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: false });
  cover(map, 0, 1);
  map.SoilDepth.set(0, 1);
  expect(() => stage.demand("soil", "load", 0, 1024, "probe")).toThrow(
    "Unsupported stage transfer"
  );
  stage.moveLoose(0, 1, map.mesh.area(0), "transport");
  stage.settle();
  expect(map.SoilDepth.get(0)).toBe(0);
  expect(map.BedrockElevation.get(0)).toBe(100 * 1024);
});

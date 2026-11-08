import { expect, it, vi } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { flowRecord } from "./flows";
import { Stage } from "./stage";
import { deposit } from "../rock/groundLedger";
import { loadOf, seaLoadOf } from "../rock/groundLoad";
import { materialLayer, readLayer, setLayer } from "../rock/rockColumn";
import { rockCatalogue } from "../rock/rockCatalogue";
import { openCut, projectGround } from "../rock/groundShares";
import { compileMix } from "../rock/modes";

function field() {
  const map = createTestField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0));
  map.BedrockElevation.fill(100 * 1024);
  map.Elevation.fill(100 * 1024);
  return map;
}
function cover(map: ReturnType<typeof field>, cell: number, metres: number) {
  deposit(map, cell, metres * 1024, "test");
}
const river = { id: "river", remembers: "CumulativeFluvialErosion" } as const;

it.each(["load", "sea"] as const)(
  "rejects material-less deposition from %s without consuming or replacing its cargo",
  (from) => {
    const map = field(),
      stage = new Stage(map, { simultaneous: true }),
      cargo = from === "load" ? loadOf(map) : seaLoadOf(map),
      volume = map.mesh.area(0);
    cargo.add(0, materialLayer(rockCatalogue.basalt.code, volume, { altered: 7, grainX: 0.5 }));
    expect(() => stage.demand(from, "loose", 0, 1024, "carrier")).toThrow(
      "Unsupported stage transfer"
    );
    stage.settle();
    expect(map.SedimentThickness.get(0)).toBe(0);
    expect(map.Elevation.get(0)).toBe(100 * 1024);
    expect(cargo.get(0)).toMatchObject({
      kind: rockCatalogue.basalt.code,
      depth: volume,
      altered: 7,
      grainX: 0.5,
    });
  }
);

it("defers weathering forcing and lets each facet's substrate determine its converted depth", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  setLayer(map, 0, 0, rockCatalogue.basalt.code, 10 * 1024, { formedMin: 4 });
  openCut(map, 0, 0.25);
  setLayer(map, 0, 0, rockCatalogue.shale.code, 20 * 1024, { formedMin: 2 }, "cut");
  projectGround(map, 0);
  stage.weatherAction(0, compileMix({ abrasion: 1 }), 1, 40, "weathering");
  expect(readLayer(map, 0, 0, "loose").depth).toBe(0);
  expect(readLayer(map, 0, 0, "cutLoose").depth).toBe(0);
  stage.settle();
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rockCatalogue.basalt.code,
    formedMin: 4,
  });
  expect(readLayer(map, 0, 0, "cutLoose")).toMatchObject({
    kind: rockCatalogue.shale.code,
    formedMin: 2,
  });
  expect(readLayer(map, 0, 0, "loose").depth).toBeGreaterThan(0);
  expect(readLayer(map, 0, 0, "cutLoose").depth).toBeGreaterThan(
    readLayer(map, 0, 0, "loose").depth
  );
  expect(map.Elevation.get(0)).toBe(100 * 1024);
});

it("does not apply a removed soluble cap's susceptibility to the exposed insoluble basement", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  setLayer(map, 0, 0, rockCatalogue.limestone.code, 1024);
  setLayer(map, 0, 1, rockCatalogue.basalt.code, 8000 * 1024);
  projectGround(map, 0);
  stage.weatherAction(0, compileMix({ solution: 1 }), 100, 40, "weathering");
  stage.demand("rock", "load", 0, 1024, "concurrent removal");
  stage.settle();
  expect(readLayer(map, 0, 0).kind).toBe(rockCatalogue.basalt.code);
  expect(readLayer(map, 0, 0, "loose").depth).toBe(0);
  expect(loadOf(map).get(0).kind).toBe(rockCatalogue.limestone.code);
});

it("keeps distinct weathering modes and shielding under the same cause", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true }),
    abrasion = compileMix({ abrasion: 1 });
  for (const cell of [0, 1, 2]) {
    setLayer(map, cell, 0, rockCatalogue.basalt.code, 8000 * 1024);
    cover(map, cell, 10);
  }
  stage.weatherAction(0, compileMix({ solution: 1 }), 100, 40, "weathering");
  stage.weatherAction(1, abrasion, 100, 5, "weathering");
  stage.weatherAction(2, abrasion, 100, 50, "weathering");
  stage.settle();
  expect(map.SedimentThickness.get(0)).toBe(10 * 1024);
  expect(map.SedimentThickness.get(1)).toBeGreaterThan(10 * 1024);
  expect(map.SedimentThickness.get(2)).toBeGreaterThan(map.SedimentThickness.get(1));
  expect(readLayer(map, 1, 1, "loose").kind).toBe(rockCatalogue.basalt.code);
  expect(readLayer(map, 2, 1, "loose").kind).toBe(rockCatalogue.basalt.code);
});

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

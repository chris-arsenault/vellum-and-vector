import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { depositShoreLoads } from "../world/coastalEvolution";
import { coastalFrame } from "../world/coastalFrame";
import { physicalContext } from "../world/context";
import { createField, type PhysicalField } from "../world/field";
import { landIce } from "../world/landIce";
import { elevationLimit, units } from "../world/math";
import { workingArray } from "../world/physicalNumerics";
import { rebuild } from "../world/surface";
import { volcanicConstruction } from "../world/volcanism";
import { createWorldMesh } from "../world/worldMesh";
import { deposit, erode, raiseFromCrust, raiseRock } from "../rock/groundLedger";
import { rockCatalogue } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { outsideWaves } from "./coast";
import { ice } from "./ice";
import { actBy } from "./processCatalogue";
import { streams } from "./streams";

/** What stops each process is the material there and how the process works, not a set amount. */
function land(height: (x: number, y: number) => number, crust = 4000): PhysicalField {
  const map = createField(createWorldMesh([-600_000, -600_000, 600_000, 600_000], 2000, 25_000));
  map.EffectiveSeaLevel = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const metres = height(map.mesh.x(i), map.mesh.y(i));
    setLayer(map, i, 0, rockCatalogue.schist.code, units(30_000));
    map.RockKindCodes.set(i, rockCatalogue.schist.code);
    map.RockResistance.set(i, rockCatalogue.schist.resistance);
    map.CrustContinentalFraction.set(i, 1000);
    map.CrustThickness.set(i, units(crust));
    map.CrustContinentalColumn.set(i, units(crust));
    map.BedrockElevation.set(i, units(metres));
    map.WaterKindCodes.set(i, metres <= 0 ? 1 : 0);
    map.Runoff.set(i, 1000);
    rebuild(map, i);
  }
  return map;
}
const context = () => physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1);
/** Ice through a row of cells running west down to `to`, sliding at `speed` m a year. */
function trunk(map: PhysicalField, speed: number, thickness = 500) {
  const cells: number[] = [];
  for (let x = 500_000; x > -500_000; x -= 25_000) {
    const i = map.mesh.cellAt(x, 0);
    if (i < 0 || cells.includes(i)) continue;
    if (cells.length) map.IceFlowTargets.set(cells[cells.length - 1], i);
    cells.push(i);
    map.IceThickness.set(i, thickness);
    map.IceFlux.set(i, speed * thickness * map.mesh.spacing);
    map.GroundedIce.set(i, 1);
  }
  return cells;
}
const metres = (map: PhysicalField, i: number) => map.Elevation.get(i) / 1024;
function cutTrunk(speed: number, ground: (x: number, y: number) => number) {
  const map = land(ground);
  map.IceFlowTargets.fill(-1);
  const cells = trunk(map, speed),
    middle = cells[Math.trunc(cells.length / 2)],
    before = metres(map, middle);
  actBy(ice)(map, context());
  return { map, cells, middle, cut: before - metres(map, middle) };
}

it("cuts faster where ice slides faster", () => {
  const slope = (x: number) => 3000 + x * 0.02;
  expect(cutTrunk(100, slope).cut).toBeGreaterThan(5 * cutTrunk(10, slope).cut);
});
it("never lets ice cut more than the fall that drives it, however fast it slides", () => {
  const { map, cells, cut } = cutTrunk(1_000_000, (x) => 3000 + x * 0.002);
  expect(cut).toBeGreaterThan(0);
  expect(cut).toBeLessThan(150);
  // The surface still falls along the flow: nothing has been dug into a pit.
  for (let n = 1; n < cells.length; n++)
    expect(map.Elevation.get(cells[n])).toBeLessThanOrEqual(map.Elevation.get(cells[n - 1]));
});
it("lets ice stop cutting once it floats, whatever falls away ahead of it", () => {
  const map = land(() => 100);
  map.IceFlowTargets.fill(-1);
  const i = map.mesh.cellAt(0, 0),
    ahead = map.mesh.cellAt(-25_000, 0);
  map.IceThickness.set(i, 500);
  map.IceFlux.set(i, 1_000_000 * 500 * map.mesh.spacing);
  map.GroundedIce.set(i, 1);
  map.IceFlowTargets.set(i, ahead);
  map.BedrockElevation.set(ahead, units(-9000));
  rebuild(map, ahead);
  actBy(ice)(map, context());
  // 500 m of ice floats in 450 m of water: its bed goes no deeper than that.
  expect(metres(map, i)).toBeGreaterThanOrEqual(-451);
  expect(metres(map, i)).toBeLessThan(0);
});
it("does not cut under ice that has no way out, however much gathers", () => {
  const map = land(() => 1000);
  map.IceFlowTargets.fill(-1);
  const i = map.mesh.cellAt(0, 0);
  map.IceThickness.set(i, 800);
  map.IceFlux.set(i, 1e15);
  map.GroundedIce.set(i, 1);
  actBy(ice)(map, context());
  expect(metres(map, i)).toBeCloseTo(1000, 0);
});
it("piles ice higher the further it stands from its edge, and thinner near it", () => {
  const map = land(() => 500);
  map.Temperature.fill(100);
  map.Moisture.fill(600);
  map.Snowfall.fill(5000);
  const inland = map.mesh.cellAt(0, 0),
    margin = map.mesh.cellAt(0, 575_000);
  for (let pass = 0; pass < 12; pass++) landIce(map, context());
  expect(map.IceThickness.get(inland)).toBeGreaterThan(1000);
  expect(map.IceThickness.get(margin)).toBeGreaterThan(0);
  expect(map.IceThickness.get(inland)).toBeGreaterThan(2 * map.IceThickness.get(margin));
});
it("stands no rock without crust to stand it from, and takes what it stands out of the crust", () => {
  const none = land(() => 1000, 4000),
    some = land(() => 1000, 4300);
  expect(raiseFromCrust(none, 0, units(1000), "test")).toBe(0);
  expect(raiseFromCrust(some, 0, units(1000), "test")).toBe(units(300));
  expect(some.CrustThickness.get(0)).toBe(units(4000));
  expect(some.SurfaceRockLoad.get(0)).toBe(units(300));
});
it("keeps rock load from falling below what wear took out of crust", () => {
  const map = land(() => 1000, 4100);
  raiseRock(map, 0, units(50), "test", "crust");
  // 50 m of pile, 100 m of spare crust, and the rest is a hole that nothing lifts back.
  erode(map, 0, units(5000), "test");
  const taken = 50 + 100 / 0.8;
  expect(map.SurfaceRockLoad.get(0) / 1024).toBeCloseTo(50 - taken, 3);
  expect(map.CrustThickness.get(0)).toBe(units(4000));
  erode(map, 0, units(5000), "test");
  expect(map.SurfaceRockLoad.get(0) / 1024).toBeCloseTo(50 - taken, 3);
});
it("lays nothing past the height limit, and says so", () => {
  const map = land(() => elevationLimit - 10),
    laid = deposit(map, 0, units(100), "test");
  expect(laid).toBe(units(10));
  expect(map.Elevation.get(0)).toBe(units(elevationLimit));
});
it("grows a vent that stays put by the volume it is fed, not a set height each pass", () => {
  const map = land(() => -3000),
    i = map.mesh.cellAt(0, 0);
  map.events.push({
    id: "plume:1",
    kind: "plume",
    x: 0,
    y: 0,
    radius: 110_000,
    epoch: 0,
    strength: 1000,
  });
  const heights: number[] = [];
  for (let pass = 0; pass < 8; pass++) {
    volcanicConstruction(map, context());
    heights.push(metres(map, i) + 3000);
  }
  expect(heights[0]).toBeGreaterThan(1000);
  const firstGain = heights[1] - heights[0],
    lastGain = heights[7] - heights[6];
  expect(lastGain).toBeLessThan(firstGain);
  expect(heights[7]).toBeLessThan(8 * heights[0] * 0.6);
});
it("fills the sea with what waves carry and no higher", () => {
  const map = land((x) => (x < 0 ? -2 : 500)),
    c = context(),
    frame = coastalFrame(map, c.Profile.CoastalActiveWidth),
    loads = workingArray(map, "float64", "test:loads"),
    i = map.mesh.cellAt(25_000, 0);
  map.WaveExposure.fill(100);
  loads.set(i, 1e15);
  frame.source.set(i, i);
  depositShoreLoads(map, c, frame, loads, true);
  for (let n = 0; n < map.mesh.count; n++)
    if (map.WaterKindCodes.get(n) === 1) expect(metres(map, n)).toBeLessThanOrEqual(0.01);
});
it("wears a shore under outside waves about as hard as under the sea's own", () => {
  const rise = land((x) => (x < 0 ? -200 : 100 + x * 0.001));
  let shore = -1;
  for (let i = 0; i < rise.mesh.count && shore < 0; i++)
    if (rise.WaterKindCodes.get(i) === 0)
      for (let edge = 0; edge < rise.mesh.degree(i); edge++) {
        const j = rise.mesh.neighbor(i, edge);
        if (j >= 0 && rise.WaterKindCodes.get(j) === 1) shore = i;
      }
  const before = metres(rise, shore);
  rise.ExternalCoastalForcing.set(shore, 1000);
  actBy(outsideWaves)(rise, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  expect(before - metres(rise, shore)).toBeGreaterThan(5);
  expect(metres(rise, shore)).toBeGreaterThanOrEqual(-30);
  expect(rise.ExternalCoastalForcing.get(shore)).toBe(0);
});
it("cuts a lake's outlet only by the water and fall there, down to what it flows into", () => {
  // A lake basin in the east, its sill, and low ground running west to the sea.
  const map = land((x) => (x > 200_000 ? 800 : x > 150_000 ? 830 : 2 + (x + 600_000) * 0.001));
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i);
    map.DrainageElevations.set(i, x > 150_000 ? units(830) : map.Elevation.get(i));
    if (x > 200_000) {
      map.WaterKindCodes.set(i, 2);
      map.WaterSurfaceElevations.set(i, units(830));
    }
  }
  const sill = map.mesh.cellAt(175_000, 0),
    below = map.mesh.cellAt(100_000, 0),
    before = metres(map, sill);
  actBy(streams)(map, context());
  expect(metres(map, sill)).toBeLessThan(before);
  expect(metres(map, sill)).toBeGreaterThanOrEqual(metres(map, below) - 1);
});

import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { enableMagic, regionalFixture, runSchedule, suppliedFeature } from "./fixture";
import { frameEdge, isContent, neighborsOf, positionOf } from "./lattice";
import { respondMagic } from "./magic/index";
import { naturalBand, type RegionalState } from "./state";

/**
 * M5 magic at depth (plan: "Magic at depth"). The engine's ground writes go through the
 * ledger, a ward spills below its ring, doors come from the capture, the captured field
 * continues across the frame edge, and charge holds ice. Each check asserts an observable of
 * the developed field or ground.
 */

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;
const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const field = (state: RegionalState, id: string) =>
  state.physical.magic!.fields.find((f) => f.definition.id === id)!;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

it("rock: Fire changes the rock's resistance through the ledger, re-evaluations converge and never stack", () => {
  const { state } = regionalFixture(mountain, 40000, 2, {
    "magic:fire:origin:vein:source": [
      "relative-intensity",
      (x, y) => (x < 20000 && Math.abs(y - 20000) < 6000 ? 900 : 0),
    ],
    fracture: ["ratio", () => 0.6],
  });
  enableMagic(state, ["fire"]);
  // The captured rock, kept before the run (the natural copy is taken on first request).
  const captured = naturalBand(state, "RockResistance");
  runSchedule(state, ["physical", "magic"]);
  const map = state.physical.map,
    fire = field(state, "fire"),
    changed = content(state).filter(
      (i) => fire.intensity.get(i) > 300 && map.RockResistance.get(i) !== captured.get(i)
    );
  expect(changed.length).toBeGreaterThan(10);
  // Re-evaluations declare their totals again: the writes converge (the opened conduits let
  // the next propagation reach further, by less each time) and never stack beyond one
  // evaluation's declared total above the captured rock.
  const cells = content(state),
    moved = () => {
      const before = Float64Array.from(cells, (i) => map.RockResistance.get(i));
      respondMagic(state);
      let count = 0;
      for (const [k, i] of cells.entries())
        if (Math.abs(map.RockResistance.get(i) - before[k]) > 1) count++;
      return count;
    },
    second = moved(),
    third = moved();
  expect(third).toBeLessThanOrEqual(second);
  const largest = fire.definition.effects.rockResistance;
  for (const i of cells)
    expect(Math.abs(map.RockResistance.get(i) - captured.get(i))).toBeLessThanOrEqual(largest + 1);
});

it("ward: the first reach below a captured Hallowed ground loses resistance where the channel leaves it", () => {
  const { state } = regionalFixture(mountain, 40000, 2, {
    "magic:hallowed:intensity": ["relative-intensity", (x) => (x < 20000 ? 800 : 0)],
    "magic:hallowed:origin:seat:source": ["relative-intensity", (x) => (x < 20000 ? 800 : 0)],
  });
  enableMagic(state, ["hallowed"]);
  const captured = naturalBand(state, "RockResistance");
  runSchedule(state, ["physical", "magic"]);
  const map = state.physical.map,
    mesh = map.mesh,
    around = new Int32Array(mesh.stride),
    spilled = content(state).filter((i) => {
      if (map.Warding.get(i) > 0 || map.RockResistance.get(i) >= captured.get(i) - 50) return false;
      const m = neighborsOf(mesh, i, around);
      for (let k = 0; k < m; k++) if (map.Warding.get(around[k]) > 0) return true;
      return false;
    });
  expect(spilled.length).toBeGreaterThan(0);
});

it("doors: a captured door's ends are kept and chilled", () => {
  const { state } = regionalFixture(mountain, 40000, 2);
  suppliedFeature(state, "door-1", "door", "structures", {
    type: "LineString",
    coordinates: [
      [10000, 12000],
      [30000, 28000],
    ],
  });
  enableMagic(state, ["veil"]);
  runSchedule(state, ["physical", "magic"]);
  const map = state.physical.map,
    veil = field(state, "veil"),
    temperature = naturalBand(state, "Temperature");
  expect(veil.doors.length).toBeGreaterThan(0);
  for (const cell of [veil.doors[0].a, veil.doors[0].b])
    expect(map.Temperature.get(cell)).toBeLessThan(temperature.get(cell) - 20);
});

it("inflow: a captured field with no source inside the frame keeps its intensity along the edge", () => {
  const { state } = regionalFixture(mountain, 40000, 2, {
    "magic:fire:intensity": ["relative-intensity", () => 600],
    "magic:fire:origin:vein:source": ["relative-intensity", () => 0],
  });
  enableMagic(state, ["fire"]);
  runSchedule(state, ["physical", "magic"]);
  const mesh = state.physical.map.mesh,
    fire = field(state, "fire"),
    intensity = (cells: number[]) => mean(cells.map((i) => fire.intensity.get(i))),
    edge = content(state).filter((i) => frameEdge(mesh, i)),
    interior = content(state).filter((i) => {
      const p = positionOf(mesh, i);
      return p.x > 10000 && p.x < 30000 && p.y > 10000 && p.y < 30000;
    });
  expect(intensity(edge)).toBeGreaterThan(500);
  expect(intensity(edge)).toBeGreaterThan(intensity(interior) + 200);
});

it("ice: Aurora's charge holds ice where its field is strong and nowhere it is weak", () => {
  const cold = (x: number, y: number) => 8 - 0.0065 * mountain(x, y),
    { state } = regionalFixture(mountain, 40000, 2, {
      temperature: ["celsius", cold],
      "magic:aurora:intensity": ["relative-intensity", (x) => (x >= 20000 ? 900 : 0)],
      "magic:aurora:stock:field/ice": ["intensity-square-metre", (x) => (x >= 20000 ? 4e9 : 0)],
    });
  enableMagic(state, ["aurora"]);
  runSchedule(state, ["physical", "magic"]);
  const map = state.physical.map,
    aurora = field(state, "aurora"),
    strong = content(state).filter((i) => aurora.intensity.get(i) >= 800),
    weak = content(state).filter((i) => aurora.intensity.get(i) < 300);
  expect(strong.length).toBeGreaterThan(10);
  expect(mean(strong.map((i) => map.IcePersistence.get(i)))).toBeGreaterThan(0.3);
  for (const i of weak) expect(map.IcePersistence.get(i)).toBe(0);
});

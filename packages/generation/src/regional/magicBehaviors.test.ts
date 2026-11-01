import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { resolutionCells } from "@atlas/domain";
import { enableMagic, regionalFixture, runSchedule } from "./fixture";
import { isContent } from "./lattice";
import { respondMagic } from "./magic/index";
import { regionalSchedule } from "./schedule";
import type { RegionalState } from "./state";

/** Gate A (spec 9.2) checks of the magic engine on the regional field. */

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;
const height = (state: RegionalState, i: number) =>
  (state.physical.map.Elevation.get(i) - state.physical.map.EffectiveSeaLevel) / 1024;
function contentCells(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
}
const intensities = (state: RegionalState, id: string) => {
  const field = state.physical.magic!.fields.find((f) => f.definition.id === id)!;
  return contentCells(state).map((i) => field.intensity.get(i));
};

it("feedback crosses rounds: Fire heating the ground in round one changes where the later rounds' relief and ice develop", () => {
  const runs = [true, false].map((fire) => {
    const { state } = regionalFixture(mountain, 40000, 2, {
      temperature: ["celsius", () => 1],
      "magic:fire:intensity": ["relative-intensity", () => 0],
      "magic:fire:origin:vein:source": [
        "relative-intensity",
        (x, y) => (x < 20000 && Math.abs(y - 20000) < 6000 ? 900 : 0),
      ],
      fracture: ["ratio", () => 0.6],
    });
    enableMagic(state, fire ? ["fire"] : []);
    runSchedule(state, ["physical", "magic"]);
    const map = state.physical.map;
    return {
      elevation: contentCells(state).map((i) => height(state, i)),
      heat: Math.max(...contentCells(state).map((i) => map.Temperature.get(i))),
    };
  });
  // The medium changed where Fire reached...
  expect(runs[0].heat).toBeGreaterThan(runs[1].heat);
  // ...and the relief derived from it differs materially there.
  let differing = 0;
  for (let i = 0; i < runs[0].elevation.length; i++)
    if (Math.abs(runs[0].elevation[i] - runs[1].elevation[i]) > 1) differing++;
  expect(differing).toBeGreaterThanOrEqual(resolutionCells * resolutionCells);
});

it("all seven remain meaningful: each enabled system develops through its own medium and re-evaluation does not ratchet", () => {
  const { state } = regionalFixture((x, y) => (x < 6000 ? -1500 : mountain(x, y)), 40000, 2, {
      water: ["category", (x) => (x < 6000 ? 1 : 0)],
      waterDepth: ["metre", (x) => (x < 6000 ? 1500 : 0)],
      temperature: ["celsius", (x) => (x >= 35000 ? -12 : 14)],
      ice: ["ratio", (x) => (x >= 35000 ? 1 : 0)],
      treeCover: ["ratio", () => 0.7],
      "magic:fire:origin:vein:source": [
        "relative-intensity",
        (x, y) =>
          (x >= 10000 && x <= 15000 && y === 20000) || (x >= 35000 && y === 20000) ? 900 : 0,
      ],
      "magic:aurora:stock:field/ice": ["intensity-square-metre", (x) => (x >= 35000 ? 4e9 : 0)],
      "magic:pressure:intensity": [
        "relative-intensity",
        (x, y) => (x <= 5000 && Math.abs(y - 20000) < 6000 ? 600 : 0),
      ],
      canopyAge: ["year", (x, y) => (x >= 20000 && x <= 25000 && y === 10000 ? 1200 : 100)],
      peatCarbon: [
        "kg-carbon/square-metre",
        (x, y) => (x >= 20000 && x <= 25000 && y === 10000 ? 20 : 0),
      ],
      "magic:salt:stock:death/bed": [
        "intensity-square-metre",
        (x, y) => (x >= 25000 && x <= 30000 && y === 0 ? 6e9 : 0),
      ],
      "magic:hallowed:intensity": [
        "relative-intensity",
        (x, y) => (x >= 15000 && x <= 20000 && y === 30000 ? 400 : 0),
      ],
    }),
    systems = enableMagic(state);
  for (const step of regionalSchedule(["physical", "magic"])) {
    step.run(state);
    if (step.id === "round-1/environment") break;
  }
  const fields = systems.map((system) => intensities(state, system.id));
  for (const [k, values] of fields.entries())
    expect(
      values.some((v) => v > 0),
      systems[k].id
    ).toBe(true);
  for (let a = 0; a < fields.length; a++)
    for (let b = a + 1; b < fields.length; b++)
      expect(correlation(fields[a], fields[b]), `${systems[a].id}/${systems[b].id}`).toBeLessThan(
        0.99
      );
  expectConvergence(state, systems);
});

/**
 * Re-evaluating against the media the first evaluation produced converges: every later
 * change is no larger than the one before it. Nothing accumulates.
 */
function expectConvergence(state: RegionalState, systems: ReturnType<typeof enableMagic>) {
  const map = state.physical.map,
    snapshot = () => ({
      fields: systems.map((system) => intensities(state, system.id)),
      temperature: contentCells(state).map((i) => map.Temperature.get(i)),
    }),
    difference = (a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>) =>
      Math.max(
        ...a.fields.map((values, k) =>
          Math.max(...values.map((v, i) => Math.abs(v - b.fields[k][i])))
        ),
        ...a.temperature.map((v, i) => Math.abs(v - b.temperature[i]))
      ),
    first = snapshot();
  respondMagic(state);
  const second = snapshot();
  respondMagic(state);
  const third = snapshot();
  expect(difference(second, third)).toBeLessThanOrEqual(difference(first, second) + 1e-9);
}

function correlation(a: number[], b: number[]) {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length,
    ma = mean(a),
    mb = mean(b),
    sum = (f: (i: number) => number) => a.reduce((s, _, i) => s + f(i), 0),
    sab = sum((i) => (a[i] - ma) * (b[i] - mb)),
    saa = sum((i) => (a[i] - ma) ** 2),
    sbb = sum((i) => (b[i] - mb) ** 2);
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { networkDivides } from "./divides";
import { regionalFixture, runSchedule } from "./fixture";
import { isContent, positionOf } from "./lattice";
import { naturalBand, type RegionalState } from "./state";

/**
 * M3 coast, climate and ice at depth (plan: "Coast, climate and ice at depth"). Each check
 * asserts an observable of the developed country against what the capture alone would give:
 * a coast retreating into its weak bands, sea the network held that a river's load has made
 * land, rain on the windward side of a ridge, ice standing on divides it could not have
 * snowed onto and widening the valley it fills.
 */

const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const land = (state: RegionalState, i: number) =>
  state.physical.map.WaterKindCodes.get(i) === 0 &&
  state.physical.map.Elevation.get(i) > state.physical.map.EffectiveSeaLevel;
const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;

it("shore: an onshore sea retreats the coast further into weak bands than into resistant ones", () => {
  // Sea south of y = 20 km, low land rising gently north of it; bands of weak and resistant
  // rock alternate every ten kilometres along the coast (two parent samples, so the capture
  // carries them); the wind blows onshore from the sea.
  const band = 10000,
    resistant = (x: number) => Math.floor(x / band) % 2 === 0,
    { state } = regionalFixture((_x, y) => (y < 20000 ? -40 : 2 + (y - 20000) / 200), 40000, 2, {
      rock: ["ratio", (x) => (resistant(x) ? 0.9 : 0.1)],
      windEast: ["ratio", () => 0],
      windNorth: ["ratio", () => 1],
    });
  runSchedule(state, ["physical"]);
  // Coves: ground the network held as land (the captured, smoothed shore) that the sea has
  // taken, per band. Weak rock carries more rivers, whose mouth loads build deltas seaward,
  // so the seaward edge is no measure.
  const map = state.physical.map,
    mesh = map.mesh,
    network = state.regional.network!,
    coves = { weak: 0, hard: 0 };
  for (const i of content(state)) {
    // The shore roots themselves stand a metre above the sea and go in any band; the coves
    // are the ground behind them that the sea took.
    if (network.sea[i] || network.receiver[i] < 0 || map.WaterKindCodes.get(i) !== 1) continue;
    coves[resistant(positionOf(mesh, i).x) ? "hard" : "weak"]++;
  }
  expect(coves.weak).toBeGreaterThan(coves.hard + 10);
  expect(coves.weak).toBeGreaterThan(1.5 * coves.hard);
});

it("mouth: a steep country shedding sediment into a sheltered shallow sea makes land of sea the network held", () => {
  const { state } = regionalFixture(
    (_x, y) => (y < 20000 ? -(4 + (20000 - y) / 400) : 100 + (y - 20000) / 15),
    40000,
    2,
    {
      windEast: ["ratio", () => 0],
      windNorth: ["ratio", () => -1],
      runoff: ["metre/year", () => 1],
    }
  );
  runSchedule(state, ["physical"]);
  // Sea at the network's base (the captured, smoothed coast) that is land now: only the
  // mouths' deltas and the lee fill make that.
  const network = state.regional.network!,
    gained = content(state).filter((i) => network.sea[i] && land(state, i));
  expect(gained.length).toBeGreaterThan(0);
});

it("wind: rainfall on the windward flank of a ridge exceeds the lee flank's", () => {
  const { state } = regionalFixture(
    (x) => 200 + 800 * Math.exp(-(((x - 20000) / 4000) ** 2)),
    40000,
    2,
    { windEast: ["ratio", () => 1], windNorth: ["ratio", () => 0] }
  );
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    mesh = map.mesh,
    rain = (select: (x: number) => boolean) =>
      mean(
        content(state)
          .filter((i) => select(positionOf(mesh, i).x))
          .map((i) => map.Rainfall.get(i))
      ),
    windward = rain((x) => x > 14000 && x < 19000),
    lee = rain((x) => x > 21000 && x < 26000);
  expect(windward).toBeGreaterThan(lee * 1.1);
});

it("ice: glaciers from the cold heights stand on divides too warm to snow on and widen the valley they fill", () => {
  // The captured temperature falls with the captured height, as a parent's does: snow
  // gathers only on the high country, so ice on warm ground has flowed there.
  const captured = (x: number, y: number) => 5 - 0.0065 * mountain(x, y),
    glaciated = regionalFixture(mountain, 40000, 2, { temperature: ["celsius", captured] }).state,
    warm = regionalFixture(mountain, 40000, 2, {
      temperature: ["celsius", (x, y) => captured(x, y) + 12],
    }).state;
  runSchedule(glaciated, ["physical"]);
  runSchedule(warm, ["physical"]);
  const map = glaciated.physical.map,
    temperature = naturalBand(glaciated, "Temperature"),
    lapsed = (i: number) =>
      temperature.get(i) / 10 -
      30 -
      (0.0065 * (map.Elevation.get(i) - glaciated.regional.inheritedHeight.get(i))) / 1024,
    crest = networkDivides(glaciated),
    transfluent = content(glaciated).filter(
      (i) => crest[i] > 0 && map.GroundedIce.get(i) > 0 && lapsed(i) > -2
    );
  expect(transfluent.length).toBeGreaterThan(0);
  // Across the valley where the glacier runs, the ice has cut more than the river's own
  // cell: the trough is wider than its river. The unglaciated valley has no glacial cut.
  const cutAcross = (state: RegionalState, x: number) =>
      content(state).filter(
        (i) =>
          Math.abs(positionOf(state.physical.map.mesh, i).x - x) < 400 &&
          Math.abs(positionOf(state.physical.map.mesh, i).y - 20000) < 4000 &&
          state.physical.map.CumulativeGlacialErosion.get(i) > 0
      ).length,
    iced = content(glaciated).filter(
      (i) =>
        map.GroundedIce.get(i) > 0 &&
        Math.abs(positionOf(map.mesh, i).y - 20000) < 1500 &&
        positionOf(map.mesh, i).x > 30000
    );
  expect(iced.length).toBeGreaterThan(0);
  const x = mean(iced.map((i) => positionOf(map.mesh, i).x));
  expect(cutAcross(glaciated, x)).toBeGreaterThan(2);
  expect(cutAcross(warm, x)).toBe(0);
});

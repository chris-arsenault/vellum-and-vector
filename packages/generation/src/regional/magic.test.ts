import { expect, it } from "vitest";
import { gridPosition, magicSurfaceCode, magicConfluenceSchema } from "@atlas/domain";
import { extractMagicPlaces } from "./extraction/magic";
import { enableMagic, regionalEnvironment } from "./fixture";
import { respondMagic } from "./magic/index";
import { prepareGreenwood, respondGreenwood } from "./magic/land";
import { intensityChannel } from "./magic/materials";
import { preparePressure, respondPressure } from "./magic/water";
import { channel } from "./state";

function magicEnvironment(ids: string[], refinementLevel = 1) {
  const f = regionalEnvironment(refinementLevel),
    systems = enableMagic(f.state, ids);
  f.state.domain.world.confluences = [];
  return {
    ...f,
    g: f.state.surface,
    systems,
    system: (id: string) => systems.find((s) => s.id === id)!,
  };
}

it("resolves Fire along captured conductive fractures without placing new sources", () => {
  const { state, g } = magicEnvironment(["fire"]),
    source = channel(state, "magic:fire:source", "relative-intensity"),
    middle = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2);
  source.set(middle, 900);
  for (let x = 0; x < g.width; x++)
    g.channels.fracture.set(Math.floor(g.height / 2) * g.width + x, 1);
  const history = structuredClone(state.domain.world.epochs);
  respondMagic(state);
  const intensity = g.channels["magic:fire:intensity"];
  expect(intensity.get(middle + 3)).toBeGreaterThan(intensity.get(middle + 3 * g.width));
  expect(Array.from(state.natural["captured:magic:fire:source"]).filter((v) => v > 0)).toHaveLength(
    1
  );
  expect(state.domain.world.epochs).toEqual(history);
});

it("resolves weak coarse Fire coverage into localized cores rather than uniformly faint heat", () => {
  const { state, g } = magicEnvironment(["fire"], 2);
  channel(state, "magic:fire:intensity", "relative-intensity", 40);
  channel(state, "magic:fire:coverage", "ratio", 0.08);
  channel(state, "magic:fire:coverage:vein", "ratio", 0.08);
  channel(state, "geothermal", "ratio", 0.8);
  g.channels.fracture.fill(0.8);
  respondMagic(state);
  const sources = Array.from(g.channels["magic:fire:source"]);
  expect(sources.some((v) => v >= 300)).toBe(true);
  expect(sources.filter((v) => v >= 300).length).toBeLessThan(sources.length / 3);
  expect(Math.max(...g.channels["magic:fire:intensity"])).toBeGreaterThan(500);
  expect(Math.max(...g.channels.temperature)).toBeGreaterThan(16);
  extractMagicPlaces(state);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "fire:core")).toBe(true);
});

it("does not invent Fire material from favorable rock and heat alone", () => {
  const { state, g } = magicEnvironment(["fire"]);
  channel(state, "geothermal", "ratio", 1);
  g.channels.fracture.fill(1);
  respondMagic(state);
  expect(Array.from(g.channels["magic:fire:source"]).every((v) => v === 0)).toBe(true);
  expect(Array.from(g.channels["magic:fire:intensity"]).every((v) => v === 0)).toBe(true);
});

it("applies a meeting's own physical effects through the ledger while retaining both contributing fields", () => {
  const { state, g } = magicEnvironment(["fire", "aurora"]);
  channel(state, "magic:fire:intensity", "relative-intensity", 900);
  channel(state, "magic:aurora:intensity", "relative-intensity", 900);
  channel(state, "magic:fire:source", "relative-intensity", 900);
  // Cold ground keeps the captured Aurora charge above the meeting floor.
  g.channels.temperature.fill(-20);
  g.channels.ice.fill(1);
  state.domain.world.confluences = [
    magicConfluenceSchema.parse({
      id: "war",
      name: "Thermal rim",
      systems: ["fire", "aurora"],
      seeds: [
        [
          { field: "system:fire", min: 300 },
          { field: "system:aurora", min: 300 },
        ],
      ],
      effects: { fractureConductance: 400, relief: 30 },
    }),
  ];
  const before = Array.from(g.channels.elevation),
    fracture = Array.from(g.channels.fracture);
  const changed = respondMagic(state);
  expect(changed.has("fracture")).toBe(true);
  expect(Array.from(g.channels.fracture).some((v, i) => v > fracture[i])).toBe(true);
  expect(Array.from(g.channels.elevation)).not.toEqual(before);
  expect(Array.from(g.channels["magic:fire:intensity"]).some((v) => v > 300)).toBe(true);
  expect(Array.from(g.channels["magic:aurora:intensity"]).some((v) => v > 300)).toBe(true);
  // Re-evaluation updates the meeting's relief (the fields respond to the heat the first
  // evaluation applied) within the declared amplitude; it never adds a second dose.
  const once = Array.from(g.channels.elevation);
  respondMagic(state);
  const twice = Array.from(g.channels.elevation);
  respondMagic(state);
  const thrice = Array.from(g.channels.elevation);
  const change = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  expect(change(twice, thrice)).toBeLessThanOrEqual(change(once, twice) + 1e-9);
  expect(Math.max(...thrice.map((v, i) => Math.abs(v - before[i])))).toBeLessThanOrEqual(30);
});

it("resolves Aurora into cold ice and retains thawed charge in the ground", () => {
  const { state, g } = magicEnvironment(["aurora"]);
  channel(state, "magic:aurora:intensity", "relative-intensity", 400);
  const stock = channel(state, "magic:aurora:stock:field/ice", "intensity-square-metre", 2000),
    before = Array.from(stock);
  for (let i = 0; i < g.active.length; i++) {
    const cold = gridPosition(g, i).x < 20000;
    g.channels.temperature.set(i, cold ? -20 : 15);
    g.channels.ice.set(i, cold ? 1 : 0);
  }
  respondMagic(state);
  expect(g.channels["magic:aurora:intensity"].get(0)).toBeGreaterThan(
    g.channels["magic:aurora:intensity"].get(g.width - 1)
  );
  const ground = g.channels["magic:aurora:stock:field/ground"];
  const sum = (values: Iterable<number>) => Array.from(values).reduce((a, b) => a + b, 0);
  expect(sum(stock) + sum(ground)).toBeCloseTo(sum(before), 6);
  for (let i = 0; i < stock.length; i++)
    if (gridPosition(g, i).x >= 20000) expect(ground.get(i)).toBeGreaterThan(0);
});

it("keeps Pressure fronts in their connected ocean and reaches new water when the passage opens", () => {
  for (const closed of [true, false]) {
    const { state, g, system } = magicEnvironment(["pressure"], 2);
    g.channels.water.fill(1);
    g.channels.waterDepth.fill(2000);
    const middle = Math.floor(g.height / 2) * g.width,
      source = channel(state, "magic:pressure:source", "relative-intensity"),
      intensity = intensityChannel(state, "pressure");
    source.set(middle + 3, 900);
    if (closed)
      for (let y = 0; y < g.height; y++)
        g.channels.water.set(y * g.width + Math.floor(g.width / 2), 0);
    preparePressure(state, system("pressure"));
    respondPressure(state, system("pressure"), intensity);
    const right = Math.floor(g.height / 2) * g.width + g.width - 3;
    if (closed) expect(intensity.get(right)).toBe(0);
    else expect(intensity.get(right)).toBeGreaterThan(0);
    expect(Math.max(...intensity)).toBeGreaterThan(0);
  }
});

it("propagates Greenwood through roots while a bare strip stops it", () => {
  for (const closed of [true, false]) {
    const { state, g, system } = magicEnvironment(["greenwood"], 2);
    g.channels.treeCover.fill(0.8);
    const middle = Math.floor(g.height / 2) * g.width,
      source = channel(state, "magic:greenwood:source", "relative-intensity"),
      intensity = intensityChannel(state, "greenwood");
    source.set(middle + 3, 900);
    if (closed)
      for (let y = 0; y < g.height; y++)
        g.channels.treeCover.set(y * g.width + Math.floor(g.width / 2), 0);
    prepareGreenwood(state, system("greenwood"));
    respondGreenwood(state, system("greenwood"), intensity);
    const right = Math.floor(g.height / 2) * g.width + g.width - 3;
    if (closed) expect(intensity.get(right)).toBe(0);
    else expect(intensity.get(right)).toBeGreaterThan(0);
    expect(intensity.get(middle + 4)).toBeGreaterThan(0);
  }
});

it("resolves Greenwood spring lines from buried material, recharge and soft rock", () => {
  const strengths = [0.1, 1].map((rock) => {
    const { state, g, system } = magicEnvironment(["greenwood"], 2),
      stock = channel(state, "magic:greenwood:stock:stand/stratum", "intensity-square-metre");
    for (let i = 0; i < stock.length; i++) stock.set(i, g.measures.get(i) * 1000);
    g.channels.rock.fill(rock);
    prepareGreenwood(state, system("greenwood"));
    respondGreenwood(state, system("greenwood"), intensityChannel(state, "greenwood"));
    return Math.max(...g.channels["magic:greenwood:origin:spring:source"]);
  });
  expect(strengths[0]).toBeGreaterThan(0);
  expect(strengths[1]).toBe(0);
});

it("carries Salt dust downwind once and leaves settled material at its original bed", () => {
  const { state, g } = magicEnvironment(["salt"], 2),
    cell = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2),
    dust = channel(state, "magic:salt:stock:death/dust", "intensity-square-metre");
  dust.set(cell, 1000);
  channel(state, "windEast", "ratio", 1);
  respondMagic(state);
  expect(dust.get(cell + 1)).toBeGreaterThan(0);
  expect(dust.get(cell - 1)).toBe(0);
  expect(g.channels["magic:salt:stock:death/bed"].get(cell)).toBeGreaterThan(0);
  const stocks = Object.keys(g.channels)
    .filter((name) => name.startsWith("magic:salt:stock:"))
    .map((name) => Array.from(g.channels[name]));
  respondMagic(state);
  respondMagic(state);
  // Transport happened at preparation; evaluation reads the reservoirs without moving them.
  Object.keys(g.channels)
    .filter((name) => name.startsWith("magic:salt:stock:"))
    .forEach((name, k) => expect(Array.from(g.channels[name])).toEqual(stocks[k]));
});

it("concentrates Salt on drying ground without creating or consuming its captured stock", () => {
  const { state, g } = magicEnvironment(["salt"]);
  channel(state, "magic:salt:intensity", "relative-intensity", 400);
  const stock = channel(state, "magic:salt:stock:death/brine", "intensity-square-metre", 3000);
  for (let i = 0; i < g.active.length; i++)
    g.channels.moisture.set(i, gridPosition(g, i).x < 20000 ? 1 : 0);
  respondMagic(state);
  expect(g.channels["magic:salt:intensity"].get(g.width - 1)).toBeGreaterThan(
    g.channels["magic:salt:intensity"].get(0)
  );
  expect(Array.from(stock).some((v) => v > 0)).toBe(true);
});

it("suppresses other fields inside captured Hallowed ground and concentrates them on its rim", () => {
  const { state, g } = magicEnvironment(["fire", "hallowed"]);
  channel(state, "magic:fire:intensity", "relative-intensity", 400);
  // A captured ward is already a source's spread: without a located source it does not
  // spread again, so its rim is where the parent left it.
  const ward = channel(state, "magic:hallowed:intensity", "relative-intensity");
  for (let i = 0; i < g.active.length; i++) ward.set(i, gridPosition(g, i).x < 20000 ? 800 : 0);
  respondMagic(state);
  const fire = g.channels["magic:fire:intensity"],
    edge = Math.ceil(g.width / 2);
  expect(fire.get(3)).toBeLessThan(fire.get(g.width - 2));
  expect(fire.get(edge)).toBeGreaterThan(fire.get(g.width - 2));
});

it("reveals Veil at a meeting's strain and pairs coherent tears into doors at extraction", () => {
  const { state, g, systems } = magicEnvironment(["fire", "aurora", "veil"]),
    fire = channel(state, "magic:fire:intensity", "relative-intensity"),
    aurora = channel(state, "magic:aurora:intensity", "relative-intensity");
  systems.find((s) => s.id === "veil")!.parameters.doorDistance = 10000;
  for (let i = 0; i < g.active.length; i++) {
    const west = gridPosition(g, i).x < 20000;
    fire.set(i, west ? 900 : 300);
    aurora.set(i, west ? 300 : 900);
  }
  const before = structuredClone(state.domain.world.epochs);
  respondMagic(state);
  expect(Array.from(g.channels["magic:veil:intensity"]).some((v) => v > 0)).toBe(true);
  expect(state.domain.world.epochs).toEqual(before);
});

it("classifies new fine geography rather than inheriting a coarse magic color", () => {
  const { state, g, system } = magicEnvironment(["fire"]),
    fire = system("fire");
  fire.features = fire.features.filter((r) => r.id === "vein");
  channel(state, "magic:fire:intensity", "relative-intensity", 800);
  for (let i = 0; i < g.active.length; i++)
    g.channels.fracture.set(i, gridPosition(g, i).x % 5000 < 2500 ? 1 : 0);
  extractMagicPlaces(state);
  const code = magicSurfaceCode(state.domain.world.magicSystems!, "fire", "vein")!;
  expect(Array.from(g.channels.finalSurface)).toContain(code);
  expect(Array.from(g.channels.finalSurface)).toContain(28);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "fire:vein")).toBe(true);
});

it("publishes one site complex instead of every peak in the same realized class", () => {
  const { state, g, system } = magicEnvironment(["fire"]),
    fire = system("fire");
  fire.features = [
    {
      id: "spring",
      name: "Spring",
      cartography: "site",
      priority: 1,
      seeds: [[{ field: "system:fire", min: 300 }]],
      coverage: { field: "system:fire", floor: 0, full: 1000 },
    },
  ];
  const intensity = channel(state, "magic:fire:intensity", "relative-intensity", 700);
  for (let i = 0; i < intensity.length; i++) if (i % 3 === 0) intensity.set(i, 900);
  extractMagicPlaces(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "fire:spring")
  ).toHaveLength(1);
  expect(Array.from(g.channels.finalSurface)).toContain(
    magicSurfaceCode(state.domain.world.magicSystems!, "fire", "spring")!
  );
});

it("keeps an isolated magic area as field coverage without inventing a named place", () => {
  const { state, g, system } = magicEnvironment(["fire"]),
    fire = system("fire"),
    center = Math.floor(g.active.length / 2);
  fire.features = [
    {
      id: "small",
      name: "Small field",
      cartography: "area",
      priority: 1,
      seeds: [[{ field: "system:fire", min: 300 }]],
    },
  ];
  channel(state, "magic:fire:intensity", "relative-intensity").set(center, 900);
  extractMagicPlaces(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "fire:small")
  ).toHaveLength(0);
  expect(g.channels.finalSurface.get(center)).toBe(
    magicSurfaceCode(state.domain.world.magicSystems!, "fire", "small")!
  );
});

it("does not activate captured material or stale coverage when its system is disabled", () => {
  const { state, g } = magicEnvironment([]),
    intensity = channel(state, "magic:fire:intensity", "relative-intensity", 900);
  channel(state, "magic:fire:source", "relative-intensity", 900);
  channel(state, "magic:fire:coverage:vein", "ratio", 0.8);
  const temperature = Array.from(g.channels.temperature);
  respondMagic(state);
  extractMagicPlaces(state);
  expect(Array.from(intensity).every((v) => v === 0)).toBe(true);
  expect(Array.from(g.channels["magic:fire:coverage:vein"]).every((v) => v === 0)).toBe(true);
  expect(Array.from(g.channels.temperature)).toEqual(temperature);
});

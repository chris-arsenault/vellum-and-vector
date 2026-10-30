import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  gridPosition,
  magicSurfaceCode,
  magicConfluenceSchema,
} from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { refineMagic } from "./magic";
import { classifyRegionalMagic } from "./magicCartography";
import { channel } from "./state";
import { applyRegionalMeetings } from "./meetings";

function magicEnvironment(ids: string[], refinementLevel = 1) {
  const f = regionalEnvironment(refinementLevel);
  f.state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: ids.includes(s.id),
  }));
  f.state.domain.world.confluences = [];
  return f;
}
it("resolves Fire along captured conductive fractures without placing new sources", () => {
  const { state } = magicEnvironment(["fire"]),
    g = state.surface,
    source = channel(state, "magic:fire:source", "relative-intensity"),
    middle = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2);
  source.set(middle, 900);
  for (let x = 0; x < g.width; x++)
    g.channels.fracture.set(Math.floor(g.height / 2) * g.width + x, 1);
  const before = Array.from(source),
    history = structuredClone(state.domain.world.epochs);
  refineMagic(state);
  const intensity = g.channels["magic:fire:intensity"];
  expect(intensity.get(middle + 3)).toBeGreaterThan(intensity.get(middle + 3 * g.width));
  expect(Array.from(source)).toEqual(before);
  expect(state.domain.world.epochs).toEqual(history);
});
it("applies a meeting's own physical effects while retaining both contributing fields", () => {
  const { state } = magicEnvironment(["fire", "aurora"]),
    g = state.surface;
  channel(state, "magic:fire:intensity", "relative-intensity", 900);
  channel(state, "magic:aurora:intensity", "relative-intensity", 900);
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
    history = structuredClone(state.domain.world.epochs);
  applyRegionalMeetings(state);
  expect(g.channels.fracture.get(0)).toBeCloseTo(0.2 + 0.4 * 0.21875, 8);
  expect(Array.from(g.channels.elevation)).not.toEqual(before);
  expect(Array.from(g.channels["magic:fire:intensity"]).every((v) => v === 900)).toBe(true);
  expect(Array.from(g.channels["magic:aurora:intensity"]).every((v) => v === 900)).toBe(true);
  expect(state.domain.world.epochs).toEqual(history);
});
it("resolves Aurora into cold ice while retaining captured material stocks", () => {
  const { state } = magicEnvironment(["aurora"]),
    g = state.surface;
  channel(state, "magic:aurora:intensity", "relative-intensity", 400);
  const stock = channel(state, "magic:aurora:stock:field/ice", "intensity-square-metre", 2000),
    before = Array.from(stock);
  for (let i = 0; i < g.active.length; i++) {
    const cold = gridPosition(g, i).x < 20000;
    g.channels.temperature.set(i, cold ? -20 : 15);
    g.channels.ice.set(i, cold ? 1 : 0);
  }
  refineMagic(state);
  expect(g.channels["magic:aurora:intensity"].get(0)).toBeGreaterThan(
    g.channels["magic:aurora:intensity"].get(g.width - 1)
  );
  expect(Array.from(stock)).toEqual(before);
  expect(g.channels["magic:aurora:source"]).toBeUndefined();
});
it("keeps Pressure in water and Greenwood on rooted ground", () => {
  const { state } = magicEnvironment(["pressure", "greenwood"]),
    g = state.surface;
  channel(state, "magic:pressure:intensity", "relative-intensity", 500);
  channel(state, "magic:greenwood:intensity", "relative-intensity", 500);
  for (let i = 0; i < g.active.length; i++)
    if (gridPosition(g, i).x < 20000) {
      g.channels.water.set(i, 1);
      g.channels.waterDepth.set(i, 3000);
    }
  g.channels.treeCover.set(g.width - 1, 0);
  refineMagic(state);
  expect(g.channels["magic:pressure:intensity"].get(0)).toBeGreaterThan(0);
  expect(g.channels["magic:greenwood:intensity"].get(0)).toBe(0);
  expect(g.channels["magic:pressure:intensity"].get(g.width - 1)).toBe(0);
  expect(g.channels["magic:greenwood:intensity"].get(g.width - 1)).toBe(0);
  expect(g.channels["magic:greenwood:intensity"].get(g.width - 3)).toBeGreaterThan(0);
});
it("concentrates Salt on drying ground without creating or consuming its captured stock", () => {
  const { state } = magicEnvironment(["salt"]),
    g = state.surface;
  channel(state, "magic:salt:intensity", "relative-intensity", 400);
  const stock = channel(state, "magic:salt:stock:death/brine", "intensity-square-metre", 3000),
    before = Array.from(stock);
  for (let i = 0; i < g.active.length; i++)
    g.channels.moisture.set(i, gridPosition(g, i).x < 20000 ? 1 : 0);
  refineMagic(state);
  expect(g.channels["magic:salt:intensity"].get(g.width - 1)).toBeGreaterThan(
    g.channels["magic:salt:intensity"].get(0)
  );
  expect(Array.from(stock)).toEqual(before);
});
it("suppresses other fields inside Hallowed ground and concentrates them on its rim", () => {
  const { state } = magicEnvironment(["fire", "hallowed"]),
    g = state.surface;
  channel(state, "magic:fire:intensity", "relative-intensity", 400);
  const ward = channel(state, "magic:hallowed:intensity", "relative-intensity");
  for (let i = 0; i < g.active.length; i++) ward.set(i, gridPosition(g, i).x < 20000 ? 800 : 0);
  refineMagic(state);
  const fire = g.channels["magic:fire:intensity"],
    edge = Math.ceil(g.width / 2);
  expect(fire.get(3)).toBeLessThan(fire.get(g.width - 2));
  expect(fire.get(edge)).toBeGreaterThan(fire.get(g.width - 2));
});
it("reveals Veil at a meeting's strain without another historical event", () => {
  const { state } = magicEnvironment(["fire", "aurora", "veil"]),
    g = state.surface;
  const fire = channel(state, "magic:fire:intensity", "relative-intensity"),
    aurora = channel(state, "magic:aurora:intensity", "relative-intensity");
  for (let i = 0; i < g.active.length; i++) {
    const west = gridPosition(g, i).x < 20000;
    fire.set(i, west ? 900 : 300);
    aurora.set(i, west ? 300 : 900);
  }
  const before = structuredClone(state.domain.world.epochs);
  refineMagic(state);
  expect(Array.from(g.channels["magic:veil:intensity"]).some((v) => v > 0)).toBe(true);
  expect(state.domain.world.epochs).toEqual(before);
});
it("classifies new fine geography rather than inheriting a coarse magic color", () => {
  const { state } = magicEnvironment(["fire"]),
    g = state.surface,
    system = state.domain.world.magicSystems![0];
  system.features = system.features.filter((r) => r.id === "vein");
  channel(state, "magic:fire:intensity", "relative-intensity", 800);
  for (let i = 0; i < g.active.length; i++)
    g.channels.fracture.set(i, gridPosition(g, i).x % 5000 < 2500 ? 1 : 0);
  classifyRegionalMagic(state);
  const code = magicSurfaceCode(state.domain.world.magicSystems!, "fire", "vein")!;
  expect(Array.from(g.channels.finalSurface)).toContain(code);
  expect(Array.from(g.channels.finalSurface)).toContain(28);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "fire:vein")).toBe(true);
});
it("publishes one site complex instead of every peak in the same realized class", () => {
  const { state } = magicEnvironment(["fire"]),
    system = state.domain.world.magicSystems![0],
    g = state.surface;
  system.features = [
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
  const before = Array.from(intensity);
  classifyRegionalMagic(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "fire:spring")
  ).toHaveLength(1);
  expect(Array.from(intensity)).toEqual(before);
  expect(Array.from(g.channels.finalSurface)).toContain(
    magicSurfaceCode(state.domain.world.magicSystems!, "fire", "spring")!
  );
});
it("keeps an isolated magic area as field coverage without inventing a named place", () => {
  const { state } = magicEnvironment(["fire"]),
    system = state.domain.world.magicSystems![0],
    g = state.surface,
    center = Math.floor(g.active.length / 2);
  system.features = [
    {
      id: "small",
      name: "Small field",
      cartography: "area",
      priority: 1,
      seeds: [[{ field: "system:fire", min: 300 }]],
    },
  ];
  channel(state, "magic:fire:intensity", "relative-intensity").set(center, 900);
  classifyRegionalMagic(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "fire:small")
  ).toHaveLength(0);
  expect(g.channels.finalSurface.get(center)).toBe(
    magicSurfaceCode(state.domain.world.magicSystems!, "fire", "small")!
  );
});
it("realizes the same small physical patch when a finer regional mesh resolves it", () => {
  const counts = [1, 2].map((level) => {
    const { state } = magicEnvironment(["fire"], level),
      system = state.domain.world.magicSystems![0],
      g = state.surface,
      intensity = channel(state, "magic:fire:intensity", "relative-intensity");
    system.features = [
      {
        id: "patch",
        name: "Patch",
        cartography: "area",
        priority: 1,
        seeds: [[{ field: "system:fire", min: 300 }]],
      },
    ];
    for (let i = 0; i < intensity.length; i++) {
      const p = gridPosition(g, i);
      if (p.x >= 4000 && p.x <= 7000 && p.y >= 4000 && p.y <= 7000) intensity.set(i, 900);
    }
    const before = Array.from(intensity);
    classifyRegionalMagic(state);
    expect(Array.from(intensity)).toEqual(before);
    return Object.values(state.domain.world.features).filter((f) => f.kind === "fire:patch").length;
  });
  expect(counts).toEqual([0, 1]);
});
it("leaves a sub-mesh non-source site as class coverage rather than a new point", () => {
  const { state } = magicEnvironment(["fire"]),
    g = state.surface,
    system = state.domain.world.magicSystems![0],
    cell = Math.floor(g.active.length / 2);
  system.features = [
    {
      id: "crater",
      name: "Crater",
      cartography: "site",
      priority: 1,
      seeds: [[{ field: "system:fire", min: 300 }]],
    },
  ];
  channel(state, "magic:fire:intensity", "relative-intensity").set(cell, 900);
  classifyRegionalMagic(state);
  expect(Object.values(state.domain.world.features)).toHaveLength(0);
  expect(g.channels.finalSurface.get(cell)).toBe(
    magicSurfaceCode(state.domain.world.magicSystems!, "fire", "crater")
  );
});

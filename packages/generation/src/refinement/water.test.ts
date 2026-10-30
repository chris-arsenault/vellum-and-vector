import { expect, it } from "vitest";
import { regionalFixture } from "./refinementFixture";
import { routeRegionalWater, refineWater } from "./water";
import { refineTerrain, updateSlopes } from "./terrain";
import { extractRegionalWater } from "./geography";
import { channel } from "./state";

it("routes a constructed catchment to its local outlets and retains its water budget", () => {
  // Supply kilometre-scale samples so each side valley resolves a separate mapped headwater.
  const f = regionalFixture((x, y) => 100 + x / 1000 + Math.abs(y - 20000) / 400, 40000, 2);
  updateSlopes(f.state);
  routeRegionalWater(f.state);
  const g = f.state.surface,
    { receiver, order } = f.state.drainage!,
    rank = new Map(Array.from(order, (i, k) => [i, k]));
  let supplied = 0,
    out = 0;
  for (let i = 0; i < g.active.length; i++) {
    supplied += (g.measures.get(i) * 0.6) / (365.25 * 24 * 3600);
    const j = receiver.get(i);
    if (j < 0) out += g.channels.flow.get(i);
    else expect(rank.get(j)!).toBeLessThan(rank.get(i)!);
  }
  expect(out).toBeCloseTo(supplied, 8);
  expect(Array.from(g.channels.riverOrder).some((r) => r > 0)).toBe(true);
  extractRegionalWater(f.state);
  const reaches = f.state.domain.world.drainage!.area.reaches;
  expect(reaches.length).toBeGreaterThan(1);
  expect(reaches.every((r) => r.coordinates.length > 1 && r.discharges[0] < 25)).toBe(true);
});
it("uses the present relative sea level rather than the world elevation datum", () => {
  const { state } = regionalFixture(() => 100);
  channel(state, "seaDatum", "metre", 1000);
  channel(state, "seaLevel", "metre", 0);
  routeRegionalWater(state);
  expect(Array.from(state.surface.channels.water).every((value) => value === 0)).toBe(true);
});
it("leaves an unsupported depression dry and fills it when supplied with runoff", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6,
    dry = regionalFixture(bowl).state,
    wet = regionalFixture(bowl).state;
  dry.surface.channels.runoff.fill(0);
  dry.surface.channels.rainfall.fill(0);
  wet.surface.channels.runoff.fill(1);
  wet.surface.channels.rainfall.fill(1.5);
  routeRegionalWater(dry);
  routeRegionalWater(wet);
  expect(Array.from(dry.surface.channels.water).every((v) => v === 0)).toBe(true);
  expect(Array.from(wet.surface.channels.water).some((v) => v === 2)).toBe(true);
  expect(Array.from(wet.surface.channels.elevation)).toEqual(
    Array.from(dry.surface.channels.elevation)
  );
});
it("adds regional channels and incision without evolving world history", () => {
  const f = regionalFixture((x, y) => 100 + x / 500 + Math.abs(y - 10000) / 100),
    history = structuredClone(f.source.world.epochs);
  refineTerrain(f.state);
  const before = Array.from(f.state.surface.channels.elevation);
  refineWater(f.state);
  expect(Array.from(f.state.surface.channels.erosion).some((d) => d > 0)).toBe(true);
  expect(Array.from(f.state.surface.channels.elevation)).not.toEqual(before);
  expect(f.state.domain.world.epochs).toEqual(history);
  expect(Array.from(f.grid.channels.elevation)).toEqual(
    Array.from(f.source.numerical.captured.channels.elevation)
  );
});

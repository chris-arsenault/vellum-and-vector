import { expect, it } from "vitest";
import { gridPosition, spatial } from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { updateSlopes } from "./terrain";
import { extractRegionalLandforms } from "./landforms";
import { Landform } from "../canonry/codes";
import { channel } from "./state";

function mountainChain(col = 0.4) {
  const { state } = regionalEnvironment(2),
    g = state.surface;
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      crest = (1 + col) / 2 + ((1 - col) / 2) * Math.cos(((p.x - 10000) * Math.PI) / 10000),
      flank = Math.exp(-Math.pow((p.y - 10000) / 4000, 2)),
      first = 100 * Math.exp(-Math.pow((p.x - 10000) / 3000, 2));
    g.channels.elevation.set(i, 100 + (2000 * crest + first) * flank);
  }
  updateSlopes(state);
  return state;
}

it("extracts separate summits, their joining pass and a connected mountain range", () => {
  const state = mountainChain(),
    g = state.surface,
    heights = Array.from(g.channels.elevation);
  extractRegionalLandforms(state);
  const features = Object.values(state.domain.world.features),
    peaks = features.filter((f) => f.kind === "peak"),
    pass = features.find((f) => f.kind === "pass"),
    ranges = features.filter((f) => f.kind === "range");
  expect(peaks).toHaveLength(2);
  for (const x of [10000, 30000])
    expect(
      peaks.some(
        (f) => f.geometry.type === "Point" && Math.abs(f.geometry.coordinates[0] - x) < 1000
      )
    ).toBe(true);
  expect(pass?.geometry.type).toBe("Point");
  if (pass?.geometry.type === "Point") {
    expect(pass.geometry.coordinates[0]).toBeCloseTo(20000, -3);
    expect(pass.geometry.coordinates[1]).toBeCloseTo(10000, -3);
  }
  expect(
    ranges.some((r) =>
      peaks.every(
        (p) =>
          p.geometry.type === "Point" &&
          spatial.pointCoverage(r.geometry)({
            x: p.geometry.coordinates[0],
            y: p.geometry.coordinates[1],
            z: 0,
          })
      )
    )
  ).toBe(true);
  expect(Array.from(g.channels.elevation)).toEqual(heights);
});

it("increases the lower summit's prominence when the joining col is lowered", () => {
  const highCol = mountainChain(0.65),
    lowCol = mountainChain(0.3);
  for (const state of [highCol, lowCol]) extractRegionalLandforms(state);
  const prominence = (state: typeof highCol) =>
    Math.min(
      ...Object.values(state.domain.world.features)
        .filter((f) => f.kind === "peak")
        .map((f) => Number(f.attributes.prominence))
    );
  expect(prominence(lowCol)).toBeGreaterThan(prominence(highCol) + 400);
});

it("keeps a sub-mesh summit as a landform class without inventing a named peak", () => {
  const { state } = regionalEnvironment(2),
    g = state.surface,
    cell = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2);
  g.channels.elevation.set(cell, 2000);
  updateSlopes(state);
  extractRegionalLandforms(state);
  expect(g.channels.landform.get(cell)).toBe(Landform.Peak);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "peak")).toHaveLength(
    0
  );
});

it("distinguishes a channel knickpoint from an uninterrupted steep river", () => {
  for (const step of [0, 1000]) {
    const { state } = regionalEnvironment(),
      g = state.surface,
      receiver = g.coverage.scratch("int32", "supplied-route", g.active.length).fill(-1),
      order = g.coverage.scratch("int32", "supplied-order", g.active.length),
      row = Math.floor(g.height / 2);
    state.drainage = { receiver, order, count: g.active.length };
    channel(state, "flow", "cubic-metre/second", 20);
    for (let i = 0; i < g.active.length; i++) {
      const x = i % g.width;
      g.channels.elevation.set(i, 1200 + x * 200 - (x < 10 ? step : 0));
      order.set(i, i);
      if (x) receiver.set(i, i - 1);
    }
    for (let x = 1; x < g.width; x++) g.channels.riverOrder.set(row * g.width + x, 2);
    updateSlopes(state);
    extractRegionalLandforms(state);
    const falls = Object.values(state.domain.world.features).filter((f) => f.kind === "waterfall");
    expect(falls).toHaveLength(step ? 1 : 0);
    if (step) expect(falls[0].attributes.height).toBe(1200);
  }
});

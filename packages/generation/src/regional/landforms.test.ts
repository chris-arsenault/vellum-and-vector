import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { spatial } from "@atlas/domain";
import { Landform } from "../canonry/codes";
import { physicalContext } from "../canonry/context";
import { landformClassification } from "../canonry/landforms";
import { units } from "../canonry/math";
import { regionalFixture, runSchedule } from "./fixture";
import { cellAt } from "./lattice";

/** Two summits on one ridge joined by a col whose height is a share of the summits'. */
function mountainChain(col = 0.4) {
  return regionalFixture(
    (x, y) => {
      const crest = (1 + col) / 2 + ((1 - col) / 2) * Math.cos(((x - 10000) * Math.PI) / 10000),
        flank = Math.exp(-Math.pow((y - 10000) / 4000, 2)),
        first = 100 * Math.exp(-Math.pow((x - 10000) / 3000, 2));
      return 100 + (2000 * crest + first) * flank;
    },
    20000,
    2
  ).state;
}

it("publishes separate summits, their joining pass and a connected mountain range", () => {
  const state = mountainChain();
  runSchedule(state, ["physical"]);
  const features = Object.values(state.domain.world.features),
    peaks = features.filter((f) => f.kind === "peak"),
    ranges = features.filter((f) => f.kind === "range"),
    map = state.physical.map;
  expect(peaks.length).toBeGreaterThanOrEqual(2);
  for (const x of [10000, 30000])
    expect(
      peaks.some(
        (f) => f.geometry.type === "Point" && Math.abs(f.geometry.coordinates[0] - x) < 2500
      )
    ).toBe(true);
  // The col between the summits is classed as a pass on the field, where the derived crest
  // dips (within a few cells of the parent's col, well inside one parent sample).
  const col = cellAt(map.mesh, 20000, 10000),
    near: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (
      Math.hypot(map.mesh.x(i) - map.mesh.x(col), map.mesh.y(i) - map.mesh.y(col)) <=
      3 * map.mesh.cellWidth(col)
    )
      near.push(i);
  expect(near.some((i) => map.LandformCodes.get(i) === Landform.Pass)).toBe(true);
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
});

it("increases the lower summit's prominence when the joining col is lowered", () => {
  const highCol = mountainChain(0.65),
    lowCol = mountainChain(0.3);
  for (const state of [highCol, lowCol]) runSchedule(state, ["physical"]);
  const prominence = (state: typeof highCol) =>
    Math.min(
      ...Object.values(state.domain.world.features)
        .filter((f) => f.kind === "peak")
        .map((f) => Number(f.attributes.prominence))
    );
  expect(prominence(lowCol)).toBeGreaterThan(prominence(highCol) + 200);
});

it("keeps a sub-mesh summit as a landform class without inventing a named peak", () => {
  const { state } = regionalFixture(() => 100, 20000, 2),
    map = state.physical.map,
    cell = cellAt(map.mesh, 20000, 10000);
  runSchedule(state, ["physical"]);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "peak")).toHaveLength(
    0
  );
  // A one-cell spike is a summit class on the field; the published peaks are unchanged.
  map.Elevation.set(cell, map.EffectiveSeaLevel + units(2000));
  landformClassification(
    map,
    physicalContext(state.regional.input.seed, 0, state.physical.profile)
  );
  expect(map.LandformCodes.get(cell)).toBe(Landform.Peak);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "peak")).toHaveLength(
    0
  );
});

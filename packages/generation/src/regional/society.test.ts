import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { point } from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { regionalFixture, runSchedule, suppliedFeature } from "./fixture";
import { cellAt, isContent, positionOf } from "./lattice";
import type { RegionalState } from "./state";

/**
 * M6 society at depth (plan: "Society at depth"). Each check asserts an observable of the
 * settled country: ways classed by the use that wore them, fields clearing the cohorts the
 * engine then grows on (against the same country unsettled), a crossing where a way meets a
 * channel away from any seat, a ruin clearing nothing, and control inherited from the
 * captured polygon.
 */

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;
const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const features = (state: RegionalState, kind: string) =>
  [...generationFeatures(state, { areaId: state.regional.input.areaId })].filter(
    (f) => f.kind === kind
  );
const seats: [string, number, number, number, string][] = [
  // The market stands south of the trunk (which runs along y = 20 km) and the villages north
  // of it, so their flows must cross the river; sixty residents wear a track, six a lane.
  ["market", 30000, 16000, 2000, "inhabited"],
  ["north-village", 12000, 28000, 60, "inhabited"],
  ["east-village", 26000, 30000, 60, "inhabited"],
  ["hamlet", 8000, 24000, 6, "inhabited"],
  ["old-seat", 35000, 30000, 300, "abandoned"],
];

/** A market seat on the trunk, two villages on the flanks, a hamlet, and an abandoned seat. */
function settledCountry(domains = ["physical", "built"]) {
  const { state } = regionalFixture(mountain, 40000, 2);
  for (const [id, x, y, population, status] of seats)
    suppliedFeature(state, id, "settlement", "settlements", point({ x, y, z: 0 }), {
      population,
      status,
      scale: population > 1000 ? "town" : "village",
    });
  suppliedFeature(
    state,
    "polity-a-control",
    "control",
    "control",
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [20000, 0],
          [20000, 40000],
          [0, 40000],
          [0, 0],
        ],
      ],
    },
    { controlledBy: "polity-a" }
  );
  runSchedule(state, domains);
  return state;
}

it("ways by use: the villages' flows into the market are tracks and the hamlet's is a lane, all drawn as land roads", () => {
  const state = settledCountry(),
    ways = features(state, "road"),
    classes = ways.map((f) => String(f.attributes.routeType));
  expect(ways.length).toBeGreaterThanOrEqual(3);
  expect(classes.filter((c) => c === "track").length).toBeGreaterThanOrEqual(2);
  expect(classes).toContain("lane");
  for (const f of ways) expect(["road", "track"]).toContain(f.attributes.roadClass);
});

it("fields: the settled country's fields hold fewer tree cohorts than the same country unsettled", () => {
  const settled = settledCountry(),
    wild = settledCountry(["physical"]),
    map = settled.physical.map,
    fields = settled.regional.fields!,
    farmed = content(settled).filter((i) => fields.kind[i] === 1),
    cohorts = (state: RegionalState, cells: number[]) =>
      mean(
        cells.map(
          (i) => state.physical.map.BroadleafCover.get(i) + state.physical.map.ConiferCover.get(i)
        )
      );
  expect(farmed.length).toBeGreaterThan(20);
  expect(cohorts(settled, farmed)).toBeLessThan(cohorts(wild, farmed) * 0.7);
  expect(mean(farmed.map((i) => map.TreeCover.get(i)))).toBeLessThan(
    mean(farmed.map((i) => wild.physical.map.TreeCover.get(i)))
  );
});

it("crossings: a way crossing a channel away from any seat publishes a ford or bridge on a channel cell", () => {
  const state = settledCountry(),
    map = state.physical.map,
    mesh = map.mesh,
    seatCells = new Set(seats.map(([, x, y]) => cellAt(mesh, x, y))),
    crossings = [...features(state, "ford"), ...features(state, "bridge")].map((f) => {
      const [x, y] = (f.geometry as GeoJSON.Point).coordinates;
      return content(state).find((i) => {
        const p = positionOf(mesh, i);
        return Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1;
      })!;
    });
  expect(crossings.length).toBeGreaterThan(0);
  for (const cell of crossings) {
    expect(map.RiverOrders.get(cell)).toBeGreaterThan(0);
    expect(seatCells.has(cell)).toBe(false);
  }
});

it("ruins: an abandoned seat clears no fields", () => {
  const state = settledCountry(),
    mesh = state.physical.map.mesh,
    fields = state.regional.fields!,
    near = content(state).filter((i) => {
      const p = positionOf(mesh, i);
      return Math.hypot(p.x - 35000, p.y - 30000) < 2500;
    });
  expect(near.some((i) => fields.kind[i] > 0)).toBe(false);
});

it("control: settlements inside the captured control polygon carry its control", () => {
  const state = settledCountry(),
    inside = features(state, "settlement").filter(
      (f) => (f.geometry as GeoJSON.Point).coordinates[0] < 20000
    ),
    outside = features(state, "settlement").filter(
      (f) => (f.geometry as GeoJSON.Point).coordinates[0] > 20000
    );
  expect(inside.length).toBeGreaterThanOrEqual(2);
  for (const f of inside) expect(f.attributes.controlledBy).toBe("polity-a");
  for (const f of outside) expect(f.attributes.controlledBy).toBeUndefined();
});

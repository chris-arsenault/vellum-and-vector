import { expect, it, vi } from "vitest";
import {
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  gridPosition,
  neighbors,
  spatial,
  putChannel,
  residentBand,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { coastalNeighbors, nearestSocietySample, SocietyNeighbors } from "./societySpatial";
import { workSamples } from "./societyWorks";
import { coastalFishery } from "./societySupport";

it.each([false, true])(
  "matches exhaustive nearest and work influence queries (adaptive=%s)",
  (adaptive) => {
    const state = landscape();
    state.surface = adaptive
      ? createAdaptiveField(
          "test",
          state.domain.scope,
          createAdaptiveTopology([0, 0, 4000, 1000], {
            maximumSize: 500,
            minimumSize: 125,
            refine: ([x]) => x < 1500,
          })
        )
      : createGrid("test", state.domain.scope, 17, 5);
    const grid = state.surface;
    for (let i = 0; i < grid.active.length; i++) if (i % 7 === 0) grid.active.set(i, 0);
    const indices = Array.from({ length: grid.active.length }, (_, i) => i).filter((i) =>
      grid.active.get(i)
    );
    for (const p of [
      { x: 0, y: 0 },
      { x: 1777, y: 532 },
      { x: -500, y: 2500 },
      { x: 4000, y: 1000 },
    ]) {
      const distance = (i: number) => {
        const q = gridPosition(grid, i);
        return Math.hypot(p.x - q.x, p.y - q.y);
      };
      const expected = [...indices].sort((a, b) => distance(a) - distance(b) || a - b)[0];
      expect(nearestSocietySample(grid, p)).toBe(expected);
      for (const radius of [1, 250, 6000]) {
        const work = {
          id: "w",
          communityId: "c",
          kind: "hunting" as const,
          position: { ...p, z: 0 },
          radius,
          magnitude: 1,
          condition: 1,
          maintained: true,
          authored: false,
          built: "era",
          applied: 0,
          causes: [],
        };
        const inside = indices.filter((i) => distance(i) <= radius);
        expect([...workSamples(state, work)]).toEqual(
          inside.length
            ? inside.map((i) => ({ i, fraction: Math.exp(-distance(i) / radius) }))
            : [
                {
                  i: expected,
                  fraction: Math.min(1, (Math.PI * radius ** 2) / grid.measures.get(expected)),
                },
              ]
        );
      }
    }
    grid.active.fill(0);
    expect(nearestSocietySample(grid, { x: 0, y: 0 })).toBe(-1);
  }
);

it.each([false, true])("retains covered and wrapped neighbor links (adaptive=%s)", (adaptive) => {
  const state = landscape(),
    scope = { ...state.domain.scope };
  scope.footprint = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [4000, 0],
        [4000, 1000],
        [0, 1000],
        [0, 0],
      ],
      [
        [1500, 250],
        [1500, 750],
        [2500, 750],
        [2500, 250],
        [1500, 250],
      ],
    ],
  };
  const grid = adaptive
    ? createAdaptiveField(
        "links",
        scope,
        createAdaptiveTopology([0, 0, 4000, 1000], {
          maximumSize: 500,
          minimumSize: 250,
          refine: ([x]) => x < 1500,
        })
      )
    : createGrid("links", scope, 5, 3);
  grid.periodicWidth = 4000;
  const read = new SocietyNeighbors(grid),
    covers = spatial.geometryCoverage(scope.footprint);
  for (let i = 0; i < grid.active.length; i++)
    expect([...read.at(i)]).toEqual(neighbors(grid, i, true, covers));
  if (!adaptive) {
    expect([...read.at(5)]).toContain(9);
    expect([...read.at(6)]).not.toContain(7);
    const cardinal = new SocietyNeighbors(grid, false);
    expect([...cardinal.at(0)]).toEqual([1, 5, 4]);
    expect([...read.at(0)]).toContain(6);
  }
});

it("reuses geometry queries while fishery reads changed sea and livelihood fields", () => {
  const state = landscape(),
    grid = state.surface,
    count = grid.active.length;
  for (const [name, unit] of [
    ["WaterKindCodes", "category"],
    ["AquaticFauna", "kg-carbon/square-metre"],
    ["Upwelling", "per-mille"],
    ["magic:pressure:intensity", "relative-intensity"],
  ] as const)
    putChannel(grid, name, unit, residentBand("float64", new Float64Array(count)));
  state.society = {
    region: {
      areaId: "area",
      spaceId: "surface",
      communities: [],
      connections: [],
      history: [],
      works: [],
      events: [],
      magic: [],
    },
    owner: residentBand("int32", new Int32Array(count)),
    river: residentBand("float64", new Float64Array(count)),
    coast: residentBand("float64", new Float64Array(count)),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
    cycle: { index: 0, elapsed: 1, final: false },
  };
  const coverage = spatial.geometryCoverage.bind(spatial),
    queries = vi.fn(coverage(grid.scope.footprint)),
    prepared = vi.spyOn(spatial, "geometryCoverage").mockReturnValue(queries);
  try {
    grid.channels.WaterKindCodes!.set(1, 1);
    const first = coastalFishery(state),
      calls = queries.mock.calls.length,
      topology = coastalNeighbors(state);
    expect(first.get(0)).toBe(0.5);
    expect(calls).toBeGreaterThan(0);
    grid.channels.AquaticFauna!.set(1, 2);
    grid.channels.Upwelling!.set(1, 500);
    grid.channels["magic:pressure:intensity"]!.set(1, 400);
    const second = coastalFishery(state);
    expect(second.get(0)).toBeCloseTo(2.85);
    expect(queries.mock.calls.length).toBe(calls);
    expect(coastalNeighbors(state)).toBe(topology);
    grid.channels.WaterKindCodes!.set(1, 0);
    const third = coastalFishery(state);
    expect(third.get(0)).toBe(0);
    state.surface = createGrid("replacement", grid.scope, 5, 2);
    expect(coastalNeighbors(state)).not.toBe(topology);
    delete state.society.cycle;
    const outsideEra = coastalNeighbors(state);
    expect(coastalNeighbors(state)).not.toBe(outsideEra);
    for (const band of [first, second, third]) grid.coverage.release(band);
  } finally {
    prepared.mockRestore();
  }
});

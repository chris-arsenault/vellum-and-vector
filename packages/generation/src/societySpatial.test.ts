import { expect, it } from "vitest";
import {
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  gridPosition,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { nearestSocietySample } from "./societySpatial";
import { workSamples } from "./societyWorks";

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

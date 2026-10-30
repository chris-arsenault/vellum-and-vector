import { expect, it } from "vitest";
import { gridPosition, point } from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { refinePlaces, regionalPath } from "./places";
import { putRefinementFeature } from "./features";

it("retains a known town and adds named smaller settlements and local ways on plains", () => {
  const { state } = regionalEnvironment(),
    p = gridPosition(state.surface, state.surface.width + 2),
    known = putRefinementFeature(
      state,
      "known",
      "settlement",
      "settlements",
      point(p),
      { population: 10000 },
      "Known town"
    );
  known.name = "Known town";
  known.placeId = "original-town";
  const before = structuredClone(known),
    history = structuredClone(state.domain.world.epochs);
  refinePlaces(state);
  const features = Object.values(state.domain.world.features),
    villages = features.filter((f) => f.attributes.scale === "village");
  expect(state.domain.world.features[known.id]).toEqual(before);
  expect(villages.length).toBeGreaterThan(1);
  expect(
    villages.every((f) => Number(f.attributes.population) < 10000 && f.name !== "Village")
  ).toBe(true);
  expect(features.some((f) => f.kind === "road")).toBe(true);
  expect(state.domain.world.epochs).toEqual(history);
});
it("routes local ways around supplied water through a dry passage", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    col = Math.floor(g.width / 2),
    pass = g.height - 2;
  for (let y = 0; y < g.height; y++) if (y !== pass) g.channels.water.set(y * g.width + col, 1);
  const start = 2 * g.width + 2,
    end = 2 * g.width + g.width - 3,
    path = regionalPath(state, start, end)!;
  expect(path[0]).toBe(start);
  expect(path.at(-1)).toBe(end);
  expect(path).toContain(pass * g.width + col);
  expect(path.every((i) => g.channels.water.get(i) === 0)).toBe(true);
});

import { expect, it } from "vitest";
import { canonryMagicPresets, canonryConfluencePresets } from "@atlas/domain";
import { regionalFixture } from "./fixture";
import { regionalSchedule } from "./schedule";
import type { RegionalState } from "./state";

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;

export function runSchedule(state: RegionalState, domains = state.input.domains) {
  for (const step of regionalSchedule(domains)) step.run(state);
  return state;
}

it("runs the three rounds, the refresh and the extraction on a supplied mountain country", () => {
  const f = regionalFixture(mountain, 40000, 2),
    state = f.state;
  state.domain.world.magicSystems = canonryMagicPresets();
  state.domain.world.confluences = canonryConfluencePresets();
  runSchedule(state);
  const g = state.surface,
    features = Object.values(state.domain.world.features);
  expect(state.round).toBe(4);
  expect(Array.from(g.channels.riverOrder).some((v) => v > 0)).toBe(true);
  expect(features.some((feature) => feature.kind === "river")).toBe(true);
  expect(Array.from(g.channels.elevation).every(Number.isFinite)).toBe(true);
  expect(Array.from(f.grid.channels.elevation)).toEqual(
    Array.from(f.source.numerical.captured.channels.elevation)
  );
});

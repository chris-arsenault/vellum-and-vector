import { expect, it } from "vitest";
import { everySample, putChannel, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializeCultures } from "./societyCulture";
import { publishCultures } from "./societyCulturePublication";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";

function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(
    state.surface,
    "elevation",
    "metre",
    residentBand("float64", new Float64Array(10).fill(100))
  );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { cultureCount: 2 },
    epochs: [epoch("Contact", 200)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  for (const c of state.society!.region.communities) c.groups[0].count = 1000;
  initializeCultures(state, context);
  return { state, context };
}
it("publishes cultural, language and religious prevalence independently", () => {
  const { state } = fixture();
  publishCultures(state);
  for (const kind of ["culture", "language", "religion"]) {
    const channels = Object.entries(state.surface.channels).filter(([key]) =>
      key.startsWith(`${kind}:`)
    );
    expect(channels.length).toBeGreaterThan(0);
    for (const [, values] of channels)
      expect(everySample(values, (v) => v >= 0 && v <= 1)).toBe(true);
  }
});

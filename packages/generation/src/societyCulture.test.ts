import { expect, it } from "vitest";
import { everySample, putChannel, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { supplySociety } from "./societyTestFixture";
import { publishCultures } from "./societyCulturePublication";
import { executeMapOperation } from "./processTraits";
import type { MapProcessContext } from "./process";

function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(
    state.surface,
    "Elevation",
    "native-length",
    residentBand("float64", new Float64Array(10).fill(102400))
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
  supplySociety(state);
  for (const c of state.society!.region.communities)
    c.groups[0] = {
      ...c.groups[0],
      culture: "supplied-culture",
      languages: ["supplied-language"],
      religions: ["supplied-faith"],
    };
  for (const [id, kind] of [
    ["supplied-culture", "culture"],
    ["supplied-language", "language"],
    ["supplied-faith", "religion"],
  ])
    state.domain.world.entities[id] = {
      id,
      kind,
      name: id,
      state: "generated",
      attributes: {},
      relations: [],
    };
  return { state, context };
}
it("publishes cultural, language and religious prevalence independently", () => {
  const { state, context } = fixture();
  executeMapOperation(publishCultures, state, context);
  for (const kind of ["culture", "language", "religion"]) {
    const channels = Object.entries(state.surface.channels).filter(([key]) =>
      key.startsWith(`${kind}:`)
    );
    expect(channels.length).toBeGreaterThan(0);
    for (const [, values] of channels)
      expect(everySample(values!, (v) => v >= 0 && v <= 1)).toBe(true);
  }
});

import { expect, it } from "vitest";
import { everySample, putChannel, residentBand, someSample } from "@atlas/domain";
import { landscape, source } from "./mapFixtures";
import { materialMagicProcess } from "./mapMagicEffects";
import { executeProcessBehavior } from "./processTraits";

it.each(["uplift", "gravity", "fertility", "luminous"])(
  "retains the existing %s intensity output without claiming physical feedback",
  async (effect) => {
    const state = landscape();
    state.domain.world.magic = [source({ effect })];
    const rock = new Float64Array(state.surface.active.length).fill(0.5);
    putChannel(state.surface, "rock", "ratio", residentBand("float64", rock));
    await executeProcessBehavior(materialMagicProcess, state, {
      scope: state.surface.scope,
      invocation: ["located-magic"],
      parameters: { sourceActivity: 1, heatActivity: 1, coldActivity: 1 },
      epochs: [],
      epochIndices: [0],
      causes: [],
      recordCause() {},
      progress() {},
      random: () => 0.5,
      cancelled: () => false,
    });
    expect(someSample(state.surface.channels["magic:thermal-core"], (value) => value > 0)).toBe(
      true
    );
    expect(Array.from(state.surface.channels.rock)).toEqual(Array.from(rock));
    expect(everySample(state.surface.channels.coastalPressure, (value) => value === 0)).toBe(true);
    expect(state.domain.world.magic[0].effect).toBe(effect);
  }
);

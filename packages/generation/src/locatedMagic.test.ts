import { expect, it } from "vitest";
import { putChannel } from "@atlas/domain";
import { landscape, source } from "./mapFixtures";
import { materialMagicProcess } from "./mapMagicEffects";
import { executeProcessBehavior } from "./processTraits";

it.each(["uplift", "gravity", "fertility", "luminous"])(
  "retains the existing %s intensity output without claiming physical feedback",
  async (effect) => {
    const state = landscape();
    state.domain.world.magic = [source({ effect })];
    const rock = new Float64Array(state.surface.active.length).fill(0.5);
    putChannel(state.surface, "rock", "ratio", rock.slice());
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
    expect(state.surface.channels["magic:thermal-core"].some((value) => value > 0)).toBe(true);
    expect(state.surface.channels.rock).toEqual(rock);
    expect(state.surface.channels.coastalPressure.every((value) => value === 0)).toBe(true);
    expect(state.domain.world.magic[0].effect).toBe(effect);
  }
);

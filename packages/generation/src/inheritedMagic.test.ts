import { expect, it } from "vitest";
import { fieldInterpolator, gridPosition, overlayField, putChannel } from "@atlas/domain";
import { landscape, source } from "./mapFixtures";
import { thermalMagicProcess, magicStorageProcess } from "./mapMagic";
import { materialMagicProcess } from "./mapMagicEffects";
import { executeProcessBehavior } from "./processTraits";
import type { MapProcessContext } from "./process";

function context(state: ReturnType<typeof landscape>): MapProcessContext {
  const causes: MapProcessContext["causes"][number][] = [];
  return {
    scope: state.surface.scope,
    invocation: ["inherited-magic"],
    parameters: { sourceActivity: 1, heatActivity: 1, coldActivity: 1 },
    epochs: [{ id: "present", duration: 2, parentEpoch: null, variables: {} }],
    epochIndices: [0],
    causes,
    recordCause: (cause) => causes.push(cause),
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
  };
}
function inherited(state: ReturnType<typeof landscape>, channels: Record<string, number>) {
  for (const [name, value] of Object.entries(channels))
    putChannel(
      state.surface,
      name,
      name === "rock" ? "ratio" : "celsius",
      new Float64Array(10).fill(value)
    );
  overlayField(state.surface, structuredClone(state.surface), Object.keys(channels), true);
}

it("replaces inherited forcing and advances retained storage once before refreshing", async () => {
  const state = landscape(),
    ctx = context(state),
    name = "magic:thermal-core",
    stored = `${name}:stored`;
  state.domain.world.magic = [source({ strength: 100 })];
  inherited(state, {
    [name]: 0.01,
    [`${name}:forcing`]: 0.01,
    [stored]: 3,
    heat: 0.01,
    storedHeat: 3,
  });
  await executeProcessBehavior(thermalMagicProcess, state, ctx);
  const p = gridPosition(state.surface, 2);
  expect(fieldInterpolator(state.surface, name)(p)).toBe(103);
  expect(fieldInterpolator(state.surface, "heat")(p)).toBe(103);
  expect(fieldInterpolator(state.surface, stored)(p)).toBe(3);
  await executeProcessBehavior(magicStorageProcess, state, ctx);
  expect(fieldInterpolator(state.surface, stored)(p)).toBe(103);
  await executeProcessBehavior(thermalMagicProcess, state, ctx);
  expect(fieldInterpolator(state.surface, name)(p)).toBe(203);
  expect(fieldInterpolator(state.surface, "storedHeat")(p)).toBe(103);
  expect(state.surface.channels[stored][2]).toBe(103);
});

it.each(["pressure", "erosionResistance"])(
  "replaces inherited %s intensity and material fields",
  async (effect) => {
    const state = landscape(),
      name = "magic:thermal-core";
    state.domain.world.magic = [source({ effect, strength: 100 })];
    inherited(state, { rock: 0.5 });
    for (const channel of [name, "coastalPressure"])
      putChannel(state.surface, channel, "ratio", new Float64Array(10).fill(0.01));
    overlayField(state.surface, structuredClone(state.surface), [name, "coastalPressure"], true);
    await executeProcessBehavior(materialMagicProcess, state, context(state));
    const p = gridPosition(state.surface, 2);
    expect(fieldInterpolator(state.surface, name)(p)).toBe(100);
    expect(fieldInterpolator(state.surface, "coastalPressure")(p)).toBe(
      effect === "pressure" ? 100 : 0
    );
    expect(fieldInterpolator(state.surface, "rock")(p)).toBe(
      effect === "erosionResistance" ? 0.6 : 0.5
    );
  }
);

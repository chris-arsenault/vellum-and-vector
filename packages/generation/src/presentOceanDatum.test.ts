import { expect, it } from "vitest";
import { MapScale, putChannel, residentBand, type FieldChannelName } from "@atlas/domain";
import { landscape, source } from "./mapFixtures";
import { magicalForcing } from "./mapMagic";
import type { MapProcessContext } from "./process";

function supplied() {
  const state = landscape(),
    set = (name: FieldChannelName, metres: number) =>
      putChannel(
        state.surface,
        name,
        "native-length",
        residentBand(
          "float64",
          new Float64Array(state.surface.active.length).fill(MapScale.native(metres))
        )
      );
  set("Elevation", 1105);
  set("BaseSeaLevel", 1000);
  set("EffectiveSeaLevel", 1110);
  return { state, set };
}

it("reads present inundation and marine source eligibility against the effective sea", () => {
  const { state, set } = supplied(),
    context: MapProcessContext = {
      scope: state.domain.scope,
      invocation: [],
      epochs: [],
      epochIndices: [],
      parameters: { sourceActivity: 1, heatActivity: 1, coldActivity: 1 },
      causes: [],
      recordCause() {},
      random: () => 0.5,
      cancelled: () => false,
      progress() {},
    },
    marine = source({ effect: "pressure", propagation: "ocean" });
  expect(magicalForcing(state, context, marine, 0)).toBeGreaterThan(0);
  set("EffectiveSeaLevel", 1100);
  expect(magicalForcing(state, context, marine, 0)).toBe(0);
});

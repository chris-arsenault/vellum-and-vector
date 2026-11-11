import { expect, it } from "vitest";
import { MapScale, putChannel, residentBand, type FieldChannelName } from "@atlas/domain";
import { landscape, source } from "./mapFixtures";
import { dryLand } from "./societySupport";
import { physicalExposures } from "./societyHazards";
import { magicalForcing } from "./mapMagic";
import { suitability } from "./mapPeople";
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
  expect(dryLand(state, 0)).toBe(false);
  expect(magicalForcing(state, context, marine, 0)).toBeGreaterThan(0);
  set("EffectiveSeaLevel", 1100);
  expect(dryLand(state, 0)).toBe(true);
  expect(magicalForcing(state, context, marine, 0)).toBe(0);
});

it("uses present coastal relief for settlement preference and tsunami exposure", () => {
  const { state, set } = supplied();
  set("EffectiveSeaLevel", 1100);
  const nearSea = suitability(state, 0);
  set("EffectiveSeaLevel", 1000);
  expect(suitability(state, 0)).toBeLessThan(nearSea);
  const values: Partial<Record<FieldChannelName, number>> = {
    Elevation: MapScale.native(1105),
    BaseSeaLevel: MapScale.native(1000),
    EffectiveSeaLevel: MapScale.native(1100),
    TectonicStrain: 1000,
  };
  const tsunami = physicalExposures((key) => values[key] ?? 0, MapScale.reference(1000)).find(
    (entry) => entry.kind === "tsunami"
  )!;
  expect(tsunami.rate).toBeGreaterThan(0);
});

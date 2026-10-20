import { expect, it } from "vitest";
import { landscape } from "../mapFixtures";
import { resolveGenerationFeatures, type FeatureSelection } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { atlasPublicationDefinitions, selectedAtlasChannels } from "./atlasPublications";
import { projectNative } from "./atlasProjection";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { Landform } from "./codes";

function fixture(selected: FeatureSelection = {}) {
  const state = landscape(),
    map = createField(createMesh(4, 0)),
    features = resolveGenerationFeatures(physicalFeatureDefinitions, selected);
  map.BaseSeaLevel = 1024 * 10;
  map.EffectiveSeaLevel = 1024 * 12;
  map.Elevation.fill(1024 * 110);
  map.CrustContinentalFraction.fill(1000);
  map.Temperature.fill(300);
  map.Moisture.fill(500);
  map.LandformCodes.fill(Landform.Peak);
  map.Slope.fill(0.01);
  map.CumulativeFluvialErosion.fill(1024);
  map.CumulativeGlacialErosion.fill(2048);
  map.CumulativeCoastalErosion.fill(3072);
  map.Rainfall.fill(3000);
  map.Snowfall.fill(1000);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: Int32Array.from(state.surface.active, (_, i) => i % 4),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
  };
  const definitions = atlasPublicationDefinitions({
    areaId: state.domain.scope.areaId,
    domains: ["physical"],
    quality: "draft",
    seed: 73,
    resolvedFeatures: features,
  });
  const channels = new Set(
    definitions.flatMap((definition) =>
      definition.kind === "field" && definition.publish !== false ? [definition.channel] : []
    )
  );
  return { state, map, channels, bindings: selectedAtlasChannels(features) };
}

it("does not classify physical material when the landform feature is disabled", () => {
  const { state, map, channels, bindings } = fixture({ "physical.landforms": { enabled: false } });
  Object.defineProperty(map, "LandformCodes", {
    get() {
      throw new Error("Disabled landform classification must not read landform codes.");
    },
  });
  projectNative(state, false, false, bindings, channels);
  expect(state.surface.channels.physicalMaterial).toBeUndefined();
  expect(state.surface.channels.landform).toBeUndefined();
  expect(state.surface.channels.elevation[0]).toBe(100);
});

it("does not compute a composite erosion product when all its owners are disabled", () => {
  const { state, map, channels, bindings } = fixture({
    "physical.river-incision": { enabled: false },
    "physical.glacial-sculpting": { enabled: false },
    "physical.coastal-evolution": { enabled: false },
  });
  Object.defineProperty(map, "CumulativeFluvialErosion", {
    get() {
      throw new Error("Disabled composite erosion must not read erosion history.");
    },
  });
  projectNative(state, false, false, bindings, channels);
  expect(state.surface.channels.erosion).toBeUndefined();
  expect(state.surface.channels.fluvialErosion).toBeUndefined();
  expect(state.surface.channels.glacialErosion).toBeUndefined();
  expect(state.surface.channels.coastalErosion).toBeUndefined();
  expect(state.surface.channels.physicalMaterial[0]).toBe(0);
});

it("retains the existing numerical output and quantity semantics for selected derived products", () => {
  const { state, channels, bindings } = fixture(),
    legacy = structuredClone(state);
  projectNative(legacy, false, false, bindings);
  projectNative(state, false, false, bindings, channels);
  expect(state.surface).toEqual(legacy.surface);
  expect(state.surface.channels.erosion[0]).toBe(6);
  expect(state.surface.channels.physicalMaterial[0]).toBe(0);
  expect(state.surface.channels.precipitation[0]).toBe(4);
  expect(state.surface.channels.waterLevel[0]).toBe(2);
  expect(state.surface.quantities?.waterLevel).toBe("category");
  expect(state.surface.units.precipitation).toBe("metre/year");
  expect(state.domain.world.features).toEqual(legacy.domain.world.features);
});

it("keeps declared internal forcing inputs available independently of final publication", () => {
  const { state } = fixture();
  projectNative(state, true, false, undefined, new Set());
  expect(state.surface.channels.naturalTemperature).toEqual(state.surface.channels.temperature);
  expect(state.surface.channels.naturalRock).toEqual(state.surface.channels.rock);
  expect(state.surface.channels.physicalMaterial).toBeUndefined();
  expect(state.surface.channels.erosion).toBeUndefined();
});

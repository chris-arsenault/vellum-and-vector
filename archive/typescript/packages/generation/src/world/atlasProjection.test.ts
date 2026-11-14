import { expect, it } from "vitest";
import {
  cloneFieldInput,
  residentBand,
  requireChannel,
  type FieldChannelName,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { resolveGenerationFeatures, type FeatureSelection } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { atlasPublicationDefinitions, selectedAtlasChannels } from "./atlasPublications";
import { projectNative } from "./atlasProjection";
import { runOperation } from "../processOperation";
import { processOwner } from "../processTraits";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createMesh } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { Landform } from "./codes";
import { groundResourceChannels } from "../rock/groundResources";
import { setLayer } from "../rock/rockColumn";
import { rockCatalogue } from "../rock/rockCatalogue";
import { GroundInventory } from "../rock/groundInventory";

it("publishes complete ground for refinement without requiring load response", () => {
  const features = resolveGenerationFeatures(
    physicalFeatureDefinitions,
    Object.fromEntries(
      physicalFeatureDefinitions.map(({ id }) => [
        id,
        { enabled: ["physical.foundation", "physical.lifecycle"].includes(id) },
      ])
    )
  );
  expect(features.diagnostics).toEqual([]);
  const selected = selectedAtlasChannels(features).map(({ name }) => name);
  for (const { name } of groundResourceChannels) {
    expect(selected).toContain(name);
  }
  const publications = atlasPublicationDefinitions({
    areaId: "area",
    domains: ["physical"],
    quality: "draft",
    seed: 73,
    resolvedFeatures: features,
  });
  for (const { name } of groundResourceChannels)
    expect(publications).toContainEqual(
      expect.objectContaining({
        kind: "field",
        channel: name,
        publish: true,
        owners: ["physical.foundation"],
      })
    );
  expect(
    publications.filter(
      (definition) => definition.kind === "field" && definition.channel === "FogForcing"
    )
  ).toHaveLength(1);
});

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
    profile: atlasPhysicalProfile({}, {}, map.scale),
    samples: residentBand(
      "int32",
      Int32Array.from(state.surface.active, (_, i) => i % 4)
    ),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
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
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  expect(state.surface.channels.PhysicalMaterial).toBeUndefined();
  expect(state.surface.channels.LandformCodes).toBeUndefined();
  expect(requireChannel(state.surface, "Elevation").get(0)).toBe(110 * 1024);
});

it("publishes present surface material as a category independently of active magic", () => {
  const { state, map, channels, bindings } = fixture();
  setLayer(map, 0, 0, rockCatalogue.keptStone.code, 100);
  setLayer(map, 0, 0, rockCatalogue.alluvium.code, 10, {}, "loose");
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  expect(requireChannel(state.surface, "SurfaceMaterial").get(0)).toBe(rockCatalogue.alluvium.code);
  expect(state.surface.units.SurfaceMaterial).toBe("category");
  expect(state.surface.quantities?.SurfaceMaterial).toBe("category");
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
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  expect(state.surface.channels.TotalErosion).toBeUndefined();
  expect(state.surface.channels.CumulativeFluvialErosion).toBeUndefined();
  expect(state.surface.channels.CumulativeGlacialErosion).toBeUndefined();
  expect(state.surface.channels.CumulativeCoastalErosion).toBeUndefined();
  expect(requireChannel(state.surface, "PhysicalMaterial").get(0)).toBe(0);
});
it("publishes canonical values, units and datum on supplied physical inputs", () => {
  const { state, map, channels, bindings } = fixture();
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  for (const { name, unit } of bindings) {
    expect(requireChannel(state.surface, name).type, name).toBe(map[name].type);
    expect(state.surface.units[name], name).toBe(unit);
  }
  expect(requireChannel(state.surface, "Elevation").get(0)).toBe(110 * 1024);
  expect(requireChannel(state.surface, "TotalErosion").get(0)).toBe(6 * 1024);
  expect(requireChannel(state.surface, "Precipitation").get(0)).toBe(4000);
  expect(requireChannel(state.surface, "EffectiveSeaLevel").get(0)).toBe(12 * 1024);
  expect(state.surface.units.Elevation).toBe("native-length");
  expect(state.surface.units.Precipitation).toBe("millimetre/year");
});

it("keeps declared internal forcing inputs available independently of final publication", () => {
  const { state } = fixture();
  runOperation(processOwner(state), projectNative, {
    state,
    forcingOnly: true,
    selectedChannels: new Set<FieldChannelName>(),
  });
  expect(Array.from(requireChannel(state.surface, "NaturalTemperature"))).toEqual(
    Array.from(requireChannel(state.surface, "Temperature"))
  );
  expect(Array.from(requireChannel(state.surface, "NaturalRockResistance"))).toEqual(
    Array.from(requireChannel(state.surface, "RockResistance"))
  );
  expect(state.surface.channels.PhysicalMaterial).toBeUndefined();
  expect(state.surface.channels.TotalErosion).toBeUndefined();
  expect(requireChannel(state.surface, "EffectiveSeaLevel").get(0)).toBe(12 * 1024);
  expect(state.surface.units.EffectiveSeaLevel).toBe("native-length");
});

it("updates existing projection buffers as the shared physical workspace advances", () => {
  const { state, map, channels, bindings } = fixture();
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  const elevation = requireChannel(state.surface, "Elevation"),
    temperature = requireChannel(state.surface, "Temperature");
  map.Elevation.fill(1024 * 210);
  map.Temperature.fill(350);
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  expect(state.surface.channels.Elevation).toBe(elevation);
  expect(state.surface.channels.Temperature).toBe(temperature);
  expect(Array.from(elevation).every((v) => v === 210 * 1024)).toBe(true);
  expect(Array.from(temperature).every((v) => v === 350)).toBe(true);
});
function chargedFixture() {
  const result = fixture(),
    key = new GroundInventory(result.map, "salt:sea/bed").key;
  setLayer(result.map, 0, 0, rockCatalogue.saltbed.code, 100, {
    cargo: new Float64Array([key, rockCatalogue.saltbed.code, 4]),
  });
  return result;
}
it("releases replaced cargo buffers while a separately captured input remains readable", () => {
  const { state, channels, bindings } = chargedFixture();
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  const previous = state.surface.materialCargo!,
    pinned = cloneFieldInput(state.surface);
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  expect(previous.offsets.released).toBe(true);
  expect(previous.records.released).toBe(true);
  expect(pinned.materialCargo!.records.get(3)).toBe(4);
  expect(state.surface.materialCargo!.records.get(3)).toBe(4);
});
it("retains cargo when selected bindings leave material channels unchanged", () => {
  const { state, map, channels, bindings } = chargedFixture();
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  const previous = state.surface.materialCargo!;
  setLayer(map, 0, 0, rockCatalogue.granite.code, 100);
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings.filter(({ name }) => name === "Temperature"),
    selectedChannels: channels,
  });
  expect(state.surface.materialCargo).toBe(previous);
  expect(previous.offsets.released).toBe(false);
  expect(requireChannel(state.surface, "RockLayerKind0").get(0)).toBe(rockCatalogue.saltbed.code);
  runOperation(processOwner(state), projectNative, {
    state,
    channels: bindings,
    selectedChannels: channels,
  });
  expect(previous.records.released).toBe(true);
  expect(state.surface.materialCargo!.records.length).toBe(0);
});
it("does not release borrowed immutable resource cargo when producing a working projection", () => {
  const source = chargedFixture();
  runOperation(processOwner(source.state), projectNative, {
    state: source.state,
    channels: source.bindings,
    selectedChannels: source.channels,
  });
  const original = source.state.surface.materialCargo!,
    borrowed = {
      ...original,
      offsets: original.offsets.snapshot({ immutable: true }),
      records: original.records.snapshot({ immutable: true }),
    },
    target = fixture();
  target.state.surface.materialCargo = borrowed;
  runOperation(processOwner(target.state), projectNative, {
    state: target.state,
    channels: target.bindings,
    selectedChannels: target.channels,
  });
  expect(borrowed.offsets.released).toBe(false);
  expect(borrowed.records.get(3)).toBe(4);
  expect(original.records.get(3)).toBe(4);
});

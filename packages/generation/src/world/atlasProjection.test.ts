import { expect, it } from "vitest";
import { cloneFieldInput, residentBand, type GridSurface } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { resolveGenerationFeatures, type FeatureSelection } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { atlasPublicationDefinitions, selectedAtlasChannels } from "./atlasPublications";
import { projectNative } from "./atlasProjection";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createMesh } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { Landform } from "./codes";
import { groundResourceBindings } from "../rock/groundResources";
import { refinementChannel } from "../regional/capture";
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
  for (const { name } of groundResourceBindings) {
    expect(selected).toContain(name);
    expect(refinementChannel(name)).toBe(true);
  }
  const publications = atlasPublicationDefinitions({
    areaId: "area",
    domains: ["physical"],
    quality: "draft",
    seed: 73,
    resolvedFeatures: features,
  });
  for (const { name } of groundResourceBindings)
    expect(publications).toContainEqual(
      expect.objectContaining({
        kind: "field",
        channel: name,
        publish: true,
        owners: ["physical.foundation"],
      })
    );
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
  projectNative(state, false, false, bindings, channels);
  expect(state.surface.channels.physicalMaterial).toBeUndefined();
  expect(state.surface.channels.landform).toBeUndefined();
  expect(state.surface.channels.elevation.get(0)).toBe(100);
});

it("publishes present surface material as a category independently of active magic", () => {
  const { state, map, channels, bindings } = fixture();
  setLayer(map, 0, 0, rockCatalogue.keptStone.code, 100);
  setLayer(map, 0, 0, rockCatalogue.alluvium.code, 10, {}, "loose");
  projectNative(state, false, false, bindings, channels);
  expect(state.surface.channels.surfaceMaterial.get(0)).toBe(rockCatalogue.alluvium.code);
  expect(state.surface.units.surfaceMaterial).toBe("category");
  expect(state.surface.quantities?.surfaceMaterial).toBe("category");
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
  expect(state.surface.channels.physicalMaterial.get(0)).toBe(0);
});
/** A grid's channel values, units and quantities, comparable without its band storage. */
const surfaceValues = (grid: GridSurface) => ({
  channels: Object.fromEntries(
    Object.entries(grid.channels).map(([name, band]) => [name, Array.from(band)])
  ),
  units: grid.units,
  quantities: grid.quantities,
  active: Array.from(grid.active),
  measures: Array.from(grid.measures),
});

it("retains the existing numerical output and quantity semantics for selected derived products", () => {
  // Two fixtures built alike: one projects every binding, the other the selected channels.
  const { state, channels, bindings } = fixture(),
    legacy = fixture().state;
  projectNative(legacy, false, false, bindings);
  projectNative(state, false, false, bindings, channels);
  expect(surfaceValues(state.surface)).toEqual(surfaceValues(legacy.surface));
  expect(state.surface.channels.erosion.get(0)).toBe(6);
  expect(state.surface.channels.physicalMaterial.get(0)).toBe(0);
  expect(state.surface.channels.precipitation.get(0)).toBe(4);
  expect(state.surface.channels.waterLevel.get(0)).toBe(2);
  expect(state.surface.quantities?.waterLevel).toBe("category");
  expect(state.surface.units.precipitation).toBe("metre/year");
  expect(state.domain.world.features).toEqual(legacy.domain.world.features);
});

it("keeps declared internal forcing inputs available independently of final publication", () => {
  const { state } = fixture();
  projectNative(state, true, false, undefined, new Set());
  expect(Array.from(state.surface.channels.naturalTemperature)).toEqual(
    Array.from(state.surface.channels.temperature)
  );
  expect(Array.from(state.surface.channels.naturalRock)).toEqual(
    Array.from(state.surface.channels.rock)
  );
  expect(state.surface.channels.physicalMaterial).toBeUndefined();
  expect(state.surface.channels.erosion).toBeUndefined();
});

it("updates existing projection buffers as the shared physical workspace advances", () => {
  const { state, map, channels, bindings } = fixture();
  projectNative(state, false, false, bindings, channels);
  const elevation = state.surface.channels.elevation,
    temperature = state.surface.channels.temperature;
  map.Elevation.fill(1024 * 210);
  map.Temperature.fill(350);
  projectNative(state, false, false, bindings, channels);
  expect(state.surface.channels.elevation).toBe(elevation);
  expect(state.surface.channels.temperature).toBe(temperature);
  expect(Array.from(elevation).every((v) => v === 200)).toBe(true);
  expect(Array.from(temperature).every((v) => v === 5)).toBe(true);
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
  projectNative(state, false, false, bindings, channels);
  const previous = state.surface.materialCargo!,
    pinned = cloneFieldInput(state.surface);
  projectNative(state, false, false, bindings, channels);
  expect(previous.offsets.released).toBe(true);
  expect(previous.records.released).toBe(true);
  expect(pinned.materialCargo!.records.get(3)).toBe(4);
  expect(state.surface.materialCargo!.records.get(3)).toBe(4);
});
it("retains cargo when preservation or selected bindings leave material channels unchanged", () => {
  const { state, map, channels, bindings } = chargedFixture();
  projectNative(state, false, false, bindings, channels);
  const previous = state.surface.materialCargo!;
  setLayer(map, 0, 0, rockCatalogue.granite.code, 100);
  projectNative(state, false, true, bindings, channels);
  expect(state.surface.materialCargo).toBe(previous);
  projectNative(
    state,
    false,
    false,
    bindings.filter(({ name }) => name === "temperature"),
    channels
  );
  expect(state.surface.materialCargo).toBe(previous);
  expect(previous.offsets.released).toBe(false);
  expect(state.surface.channels.rockLayer0.get(0)).toBe(rockCatalogue.saltbed.code);
  projectNative(state, false, false, bindings, channels);
  expect(previous.records.released).toBe(true);
  expect(state.surface.materialCargo!.records.length).toBe(0);
});
it("does not release borrowed immutable resource cargo when producing a working projection", () => {
  const source = chargedFixture();
  projectNative(source.state, false, false, source.bindings, source.channels);
  const original = source.state.surface.materialCargo!,
    borrowed = {
      ...original,
      offsets: original.offsets.snapshot({ immutable: true }),
      records: original.records.snapshot({ immutable: true }),
    },
    target = fixture();
  target.state.surface.materialCargo = borrowed;
  projectNative(target.state, false, false, target.bindings, target.channels);
  expect(borrowed.offsets.released).toBe(false);
  expect(borrowed.records.get(3)).toBe(4);
  expect(original.records.get(3)).toBe(4);
});

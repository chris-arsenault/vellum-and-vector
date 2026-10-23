import { expect, it } from "vitest";
import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  magicSystemSchema,
  spatial,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { extractEcologicalFeatures } from "./ecologyFeatures";
import { oceanFootprint } from "./geographicContours";

function fixture() {
  const state = landscape();
  const topology = createAdaptiveTopology(state.surface.bounds, {
    maximumSize: 500,
    minimumSize: 125,
  });
  state.surface = createAdaptiveField("ecology", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: false,
    samples: map.mesh.leafToCell,
    sampling: { maximumSize: 500, minimumSize: 125, featureSamples: 2 },
  };
  map.Rainfall.fill(800);
  map.Elevation.fill(100 * 1024);
  map.DrainageElevations.set(map.Elevation);
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  return state;
}

it("outlines named biomes from cover and names them from regional climate", () => {
  const state = fixture(),
    map = state.physical!.map;
  // [grass, wetland, temperature (0.1 °C above −30 °C), slope] → kind and name.
  for (const [grass, wetland, temperature, slope, kind, name] of [
    [0, 0, 450, 0.02, "barren", "Rock barrens"],
    [0, 0, 450, 0.005, "barren", "Cold desert"],
    [0, 0, 550, 0.005, "barren", "Hot desert"],
    [0.6, 0, 450, 0.005, "grassland", "Prairie"],
    [0.6, 0, 550, 0.005, "grassland", "Savanna"],
    [0.6, 0, 300, 0.005, "grassland", "Tundra"],
    [0, 0.6, 450, 0.005, "wetland", "Marsh"],
  ] as const) {
    state.domain.world.features = {};
    map.GrassCover.fill(grass);
    map.WetlandCover.fill(wetland);
    map.Temperature.fill(temperature);
    map.Slope.fill(slope);
    extractEcologicalFeatures(state);
    const features = Object.values(state.domain.world.features);
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.attributes.biome).toBe(name);
      expect(feature.kind).toBe(kind);
      expect(feature.layerId).toBe("ecology");
      expect(feature.geometry.type).toMatch(/Polygon/);
      expect(spatial.covers(state.domain.scope.footprint, feature.geometry)).toBe(true);
    }
  }
});

it("stops biome outlines exactly at the generated coast", () => {
  const state = fixture(),
    map = state.physical!.map;
  map.GrassCover.fill(0.6);
  map.Temperature.fill(450);
  const [x0, , x1] = state.surface.bounds,
    shore = (x0 + x1) / 2;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i] + map.mesh.origin[0];
    map.Elevation[i] = ((100 * (shore - x)) / (x1 - x0)) * 1024;
    map.WaterKindCodes[i] = x > shore ? 1 : 0;
  }
  state.surface.ocean = oceanFootprint(state);
  extractEcologicalFeatures(state);
  const grass = Object.values(state.domain.world.features).filter((f) => f.kind === "grassland");
  expect(grass.length).toBeGreaterThan(0);
  for (const feature of grass) {
    const overlap = spatial.intersection(feature.geometry, state.surface.ocean!);
    expect(overlap ? spatial.area(overlap) : 0).toBeLessThan(1);
  }
  // The grass reaches the shore everywhere: no strip of unnamed land between it and the sea.
  const land = spatial.differenceFrom(state.surface.ocean!)(state.domain.scope.footprint)!,
    covered = grass.reduce((sum, feature) => sum + spatial.area(feature.geometry), 0);
  expect(covered / spatial.area(land)).toBeGreaterThan(0.999);
});

it("names Fire's ember grassland and thaw ground from its fire and heat effects", () => {
  const state = fixture(),
    map = state.physical!.map,
    count = map.mesh.count;
  const system = (fire: number) => {
    const definition = magicSystemSchema.parse({
      id: "fire",
      name: "Fire",
      source: "geothermal",
      propagation: "fracture",
      phase: "climate",
      effects: { heat: 0.36, fire },
    });
    const field = { definition, intensity: new Float64Array(count).fill(800) };
    // Climate already carries the applied heat: 5 °C here, −5 °C without it.
    state.physical!.magic = {
      fields: [field],
      heat: new Float64Array(count).fill(100),
    } as unknown as NonNullable<typeof state.physical>["magic"];
  };
  map.GrassCover.fill(0.6);
  map.Temperature.fill(350);
  map.Slope.fill(0.005);
  for (const [fire, kind, name] of [
    [0.8, "ember", "Ember grassland"],
    [0, "thaw", "Thaw meadow"],
  ] as const) {
    state.domain.world.features = {};
    system(fire);
    extractEcologicalFeatures(state);
    const features = Object.values(state.domain.world.features);
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.kind).toBe(kind);
      expect(feature.attributes.biome).toBe(name);
      expect(feature.attributes.system).toBe("fire");
    }
  }
});

import { expect, it } from "vitest";
import {
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
  residentBand,
  spatial,
} from "@atlas/domain";
import { worldGeographyFixture } from "./canonry/worldGeographyFixtures";
import { generatedFeature } from "./mapFeatures";
import { refreshSocietyEnvironment } from "./societyEnvironment";
import { defaultAtlasParameters } from "./atlasParameters";
import { generationSettingsSchema } from "./generationSettings";
import { generationBindings, serializableBindings } from "./generationBindings";
import type { GenerationState, MapProcessContext } from "./process";

function coastalWorld() {
  const state = worldGeographyFixture([0, 0, 2_000_000, 1_000_000], 125_000),
    map = state.physical!.map,
    grid = state.surface;
  map.OpenBoundary = true;
  map.SeaLevelInitialized = true;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i) + map.mesh.origin[0];
    map.Elevation.set(i, (x - 500_000) * 1.024);
    map.WaterKindCodes.set(i, Number(x < 500_000));
  }
  map.BedrockElevation.copyFrom(map.Elevation);
  map.DrainageElevations.copyFrom(map.Elevation);
  grid.ocean = rectangle([0, 0, 500_000, 1_000_000]);
  const ocean = generatedFeature(state, "ocean", "Known sea", "ocean", "oceans", grid.ocean, {
    sourceAlgorithm: "canonry-0f62584c",
    marineType: "ocean",
  });
  ocean.name = "Known sea";
  ocean.placeId = "c27ca258-90b7-4f55-bb2a-548283101efb";
  state.domain.world.features[ocean.id] = ocean;
  const captured = { ...ocean, id: "captured-sea", areaId: "child", name: "Child sea" };
  state.domain.world.areas.child = {
    ...state.domain.world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region",
    map: { sourceAreaId: "area", sourceRevision: 1 },
  };
  state.domain.world.features[captured.id] = captured;
  for (const name of ["elevation", "water"])
    putChannel(
      grid,
      name,
      name === "elevation" ? "metre" : "category",
      generateBand(grid.coverage, "float64", `supplied:${name}`, (i) => {
        const x = gridPosition(grid, i).x;
        return name === "elevation" ? (x - 500_000) / 1000 : Number(x < 500_000);
      })
    );
  const n = grid.active.length;
  state.society = {
    region: {
      areaId: "area",
      spaceId: "surface",
      communities: [],
      connections: [],
      works: [],
      events: [],
      magic: [],
      history: [],
    },
    owner: residentBand("int32", new Int32Array(n).fill(-1)),
    river: residentBand("float64", new Float64Array(n)),
    coast: residentBand("float64", new Float64Array(n)),
    inherited: false,
    changed: new Set(["elevation"]),
    mediumChanged: new Set(["elevation"]),
  };
  const context = coastalContext(state);
  state.domain.world.epochs = generationBindings(context).settings.epochs;
  return { state, context, ocean, captured };
}

function coastalContext(state: GenerationState): MapProcessContext {
  return {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
    inputs: serializableBindings({
      seed: 42,
      quality: "draft",
      domains: ["physical"],
      parameters: defaultAtlasParameters,
      settings: generationSettingsSchema.parse({
        epochs: [
          {
            id: "Supplied",
            duration: 1,
            tectonics: 0,
            hydrology: 0,
            ice: 0,
            coasts: 0,
            temperature: 15,
            seaLevel: 0,
          },
        ],
        magicSystems: [],
        humanEras: [],
      }),
      features: {
        selection: { "magic.configured": { enabled: false, settings: {}, configuration: {} } },
        diagnostics: [],
        parameters: defaultAtlasParameters,
      },
    }),
  };
}

it.each([-100, 100])(
  "keeps sea outlines on the current shoreline after a %im coastal change",
  (change) => {
    const { state, context, ocean, captured } = coastalWorld(),
      before = structuredClone(ocean.geometry),
      history = structuredClone(state.domain.world.epochs),
      child = structuredClone(captured),
      events = structuredClone(state.physical!.map.events);
    for (let i = 0; i < state.surface.active.length; i++)
      state.surface.channels.elevation.add(i, change);
    refreshSocietyEnvironment(state, context, 0);
    const shore = state.surface.ocean!,
      published = Object.values(state.domain.world.features).filter(
        (f) => f.kind === "ocean" && f.areaId === "area"
      );
    expect(spatial.area(shore)).not.toBe(spatial.area(before));
    expect(spatial.bounds(shore)[2]).toBeCloseTo(500_000 - change * 1000, 3);
    expect(published.length).toBeGreaterThan(0);
    const visible = spatial.unionAll(published.map((f) => f.geometry));
    expect(spatial.difference(shore, visible)).toBeNull();
    expect(spatial.difference(visible, shore)).toBeNull();
    expect(published.find((f) => f.id === ocean.id)?.name).toBe("Known sea");
    expect(published.find((f) => f.id === ocean.id)?.placeId).toBe(ocean.placeId);
    expect(state.domain.world.epochs).toEqual(history);
    expect(state.domain.world.features[captured.id]).toEqual(child);
    expect(state.physical!.map.events).toEqual(events);
  }
);

it("retains the sea record when feedback leaves its shore unchanged", () => {
  const { state, context, ocean } = coastalWorld();
  state.society!.changed.clear();
  state.society!.mediumChanged.clear();
  refreshSocietyEnvironment(state, context, 0);
  expect(state.domain.world.features[ocean.id]).toBe(ocean);
});

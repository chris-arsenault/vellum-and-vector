import { expect, it } from "vitest";
import {
  createGrid,
  gridPosition,
  overlayField,
  putChannel,
  rectangle,
  resample,
  type GridSurface,
} from "@atlas/domain";
import { resetForcingProcess, temperatureProcess, precipitationProcess } from "./mapClimate";
import { thermalMagicProcess } from "./mapMagic";
import { configuration, invoke, landscape, options, registry } from "./mapFixtures";
import { MapRunner } from "./mapRunner";
import type { GenerationState, MapProcess } from "./process";

const flatten: MapProcess = {
  contract: {
    id: "terrain.flatten",
    version: "1",
    parameters: {},
    requires: ["elevation"],
    produces: ["elevation"],
    invalidates: ["temperature", "precipitation"],
  },
  apply(state) {
    state.surface.channels.elevation.fill(0);
  },
  validate() {
    return [];
  },
};

function authoredRidge(): GenerationState {
  const initial = landscape(),
    base: GridSurface = structuredClone(initial.surface),
    footprint = rectangle([1500, 0, 2500, 1000]),
    patch = createGrid("authored-ridge", { ...initial.domain.scope, footprint }, 3, 2);
  putChannel(patch, "elevation", "metre", new Float64Array(6).fill(2000));
  overlayField(base, patch);
  initial.domain.numerical.height = base;
  initial.domain.numerical[patch.id] = patch;
  initial.domain.world.fields.push({
    id: "height",
    areaId: "area",
    layerId: "physical",
    algorithm: "terrain",
    source: { kind: "run", id: "old-run" },
    samples: 10,
    channels: ["elevation"],
    state: "generated",
  });
  initial.domain.fieldPatches.push({
    id: "ridge-patch",
    fieldId: "height",
    areaId: "area",
    spaceId: "surface",
    footprint,
    channels: ["elevation"],
    actor: "creator",
    resourceId: patch.id,
    protected: true,
    createdVersion: 1,
  });
  return initial;
}

it("composes an authored fine ridge into regenerated base samples before climate and rain consume it", async () => {
  const initial = authoredRidge();
  const result = await new MapRunner(
    configuration([
      invoke(flatten),
      invoke(resetForcingProcess),
      invoke(temperatureProcess),
      invoke(precipitationProcess),
    ]),
    registry(flatten)
  ).run(initial, options);
  expect(result.state.surface.channels.elevation[1]).toBe(0);
  expect(result.state.surface.channels.elevation[2]).toBe(2000);
  expect(result.state.surface.channels.temperature[2]).toBe(2);
  expect(result.state.surface.channels.temperature[1]).toBe(15);
  expect(result.state.surface.channels.precipitation[2]).toBeGreaterThan(
    result.state.surface.channels.precipitation[3]
  );
  expect(result.state.domain.fieldPatches).toEqual(initial.domain.fieldPatches);
  expect(result.state.domain.numerical.height.overlays).toEqual(
    initial.domain.numerical.height.overlays
  );
  expect(result.state.domain.numerical["authored-ridge"]).toEqual(
    initial.domain.numerical["authored-ridge"]
  );
  expect(initial.surface.channels.elevation[2]).toBe(1100);
});

it("rejects incompatible authored units and changes to exact authored patch resources", async () => {
  const initial = authoredRidge();
  initial.domain.numerical.height.units.elevation = "kilometre";
  await expect(
    new MapRunner(configuration([invoke(flatten)]), registry(flatten)).run(initial, options)
  ).rejects.toThrow(/retain their units/);
  const corrupt: MapProcess = {
    ...flatten,
    contract: { ...flatten.contract, id: "terrain.corrupt" },
    apply(state) {
      state.domain.numerical["authored-ridge"].channels.elevation[0] = 1;
    },
  };
  await expect(
    new MapRunner(configuration([invoke(corrupt)]), registry(corrupt)).run(authoredRidge(), options)
  ).rejects.toThrow(/immutable sampled patch|exact sampled overlays/);
});

const highPoint: MapProcess = {
  contract: {
    id: "gis.highPoint",
    version: "1",
    parameters: {},
    requires: ["elevation"],
    produces: ["peak"],
    invalidates: [],
  },
  apply(state, context) {
    const elevation = state.surface.channels.elevation,
      i = elevation.reduce(
        (highest, value, index) => (value > elevation[highest] ? index : highest),
        0
      ),
      position = gridPosition(state.surface, i),
      geometry = { type: "Point" as const, coordinates: [position.x, position.y, elevation[i]] },
      old = state.domain.world.features.ridge;
    if (old)
      old.detail[context.scope.areaId] = {
        geometry,
        state: "generated",
        protected: false,
        needsReconciliation: false,
        attributes: null,
        actor: "generation",
        generationId: null,
      };
    else
      state.domain.world.features.ridge = {
        id: "ridge",
        name: "Ridge summit",
        kind: "peak",
        layerId: "physical",
        areaId: context.scope.areaId,
        geometry,
        detail: {},
        attributes: {},
        relations: [],
        state: "generated",
        protected: false,
        actor: "generation",
        generationId: null,
        causes: [],
      };
    context.recordCause({
      kind: "domain",
      process: "gis.highPoint",
      subjects: ["ridge"],
      description: "Summit derived from the working elevation field.",
    });
  },
  validate() {
    return [];
  },
};

it("reuses a registered GIS process and repeated climate passes over world and regional maps with stable identity", async () => {
  const config = configuration([
      invoke(resetForcingProcess),
      invoke(temperatureProcess, "natural"),
      invoke(thermalMagicProcess),
      invoke(temperatureProcess, "forced"),
      invoke(highPoint),
    ]),
    runner = new MapRunner(config, registry(highPoint)),
    world = (await runner.run(landscape(), options)).state,
    footprint = rectangle([1000, 0, 3000, 1000]),
    scope = { ...world.domain.scope, areaId: "region", footprint },
    surface = createGrid("regional", scope, 3, 2);
  resample(world.surface, surface, "elevation");
  const initial = structuredClone(world);
  initial.domain.world.areas.region = {
    ...initial.domain.world.areas.area,
    id: "region",
    parentId: "area",
    profile: "region",
    footprint,
  };
  initial.domain.scope = scope;
  initial.surface = surface;
  const region = (await runner.run(initial, options)).state;
  expect(Object.keys(region.domain.world.features)).toEqual(["ridge"]);
  expect(region.domain.world.features.ridge.areaId).toBe("area");
  expect(region.domain.world.features.ridge.geometry).toEqual(
    world.domain.world.features.ridge.geometry
  );
  expect(region.domain.world.features.ridge.detail.region.geometry).toEqual(
    world.domain.world.features.ridge.geometry
  );
  expect(region.surface.channels.temperature[1]).toBe(world.surface.channels.temperature[2]);
});

it("rejects overwriting authored vectors and completed history before a boundary is exposed", async () => {
  const initial = (
    await new MapRunner(configuration([invoke(highPoint)]), registry(highPoint)).run(
      landscape(),
      options
    )
  ).state;
  initial.domain.world.features.ridge.state = "authored";
  const overwrite: MapProcess = {
    ...flatten,
    contract: { ...flatten.contract, id: "gis.overwrite" },
    apply(state) {
      state.domain.world.features.ridge.name = "Replacement";
    },
  };
  await expect(
    new MapRunner(configuration([invoke(overwrite)]), registry(overwrite)).run(initial, options)
  ).rejects.toThrow(/preserves authored feature/);
  initial.history.push({ path: ["old"], ancestry: [], causes: [] });
  const rewriteHistory: MapProcess = {
    ...flatten,
    contract: { ...flatten.contract, id: "history.rewrite" },
    apply(state) {
      state.history = [];
    },
  };
  let exposed = false;
  await expect(
    new MapRunner(configuration([invoke(rewriteHistory)]), registry(rewriteHistory)).run(initial, {
      ...options,
      async saveBoundary() {
        exposed = true;
      },
    })
  ).rejects.toThrow(/retains completed historical/);
  expect(exposed).toBe(false);
});

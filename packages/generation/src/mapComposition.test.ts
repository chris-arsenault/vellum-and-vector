import { expect, it } from "vitest";
import {
  copyGrid,
  createGrid,
  foldSamples,
  generateChannel,
  gridPosition,
  overlayField,
  putChannel,
  rectangle,
  type GridSurface,
} from "@atlas/domain";
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
  behavior: {
    kind: "model-pass",
    applyPass(state) {
      state.surface.channels.elevation.fill(0);
    },
  },
  validate() {
    return [];
  },
};

function authoredRidge(): GenerationState {
  const initial = landscape(),
    base: GridSurface = copyGrid(initial.surface),
    footprint = rectangle([1500, 0, 2500, 1000]),
    patch = createGrid("authored-ridge", { ...initial.domain.scope, footprint }, 3, 2);
  putChannel(
    patch,
    "elevation",
    "metre",
    generateChannel(patch, "elevation", () => 2000)
  );
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

it("rejects incompatible authored units and changes to exact authored patch resources", async () => {
  const initial = authoredRidge();
  initial.domain.numerical.height.units.elevation = "kilometre";
  await expect(
    new MapRunner(configuration([invoke(flatten)]), registry(flatten)).run(initial, options)
  ).rejects.toThrow(/retain their units/);
  const corrupt: MapProcess = {
    ...flatten,
    contract: { ...flatten.contract, id: "terrain.corrupt" },
    behavior: {
      kind: "model-pass",
      applyPass(state) {
        state.domain.numerical["authored-ridge"].channels.elevation.set(0, 1);
      },
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
  behavior: {
    kind: "extract",
    extract(state, context) {
      const elevation = state.surface.channels.elevation,
        i = foldSamples(
          elevation,
          (highest, value, index) => (value > elevation.get(highest) ? index : highest),
          0
        ),
        position = gridPosition(state.surface, i),
        geometry = {
          type: "Point" as const,
          coordinates: [position.x, position.y, elevation.get(i)],
        },
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
  },
  validate() {
    return [];
  },
};

it("rejects overwriting authored vectors and completed history before a boundary is exposed", async () => {
  // A run owns its working state; each attempt starts from its own authored world.
  const authored = async () => {
    const state = (
      await new MapRunner(configuration([invoke(highPoint)]), registry(highPoint)).run(
        landscape(),
        options
      )
    ).state;
    state.domain.world.features.ridge.state = "authored";
    return state;
  };
  let initial = await authored();
  const overwrite: MapProcess = {
    ...flatten,
    contract: { ...flatten.contract, id: "gis.overwrite" },
    behavior: {
      kind: "model-pass",
      applyPass(state) {
        state.domain.world.features.ridge.name = "Replacement";
      },
    },
  };
  await expect(
    new MapRunner(configuration([invoke(overwrite)]), registry(overwrite)).run(initial, options)
  ).rejects.toThrow(/preserves authored feature/);
  initial = await authored();
  initial.history.push({ path: ["old"], ancestry: [], causes: [] });
  const rewriteHistory: MapProcess = {
    ...flatten,
    contract: { ...flatten.contract, id: "history.rewrite" },
    behavior: {
      kind: "model-pass",
      applyPass(state) {
        state.history = [];
      },
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

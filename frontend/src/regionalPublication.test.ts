import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import {
  atlasGenerationModules,
  generationSnapshot,
  prepareRegionalRefinement,
} from "@atlas/generation";
import { MapRunner } from "../../packages/generation/src/mapRunner";
import { regionalInitialState } from "../../packages/generation/src/regional/capture";
import { constructedWorld } from "./constructedWorldFixture";
import { numericalValues, snapshotCopy } from "./testSupport/snapshotCopy";

it("publishes refined regional geography from the captured parent products without changing the parent", async () => {
  const { input, result } = constructedWorld(),
    parent = generationSnapshot(result, input, crypto.randomUUID()),
    original = snapshotCopy(parent),
    domain = snapshotCopy(parent),
    areaId = crypto.randomUUID(),
    footprint = rectangle([2200, 100, 3800, 900]);
  // The region is an independent map whose captured inputs are the parent's present channels.
  domain.world.areas[areaId] = {
    ...structuredClone(domain.world.areas[input.areaId]),
    id: areaId,
    name: "A closer look",
    parentId: input.areaId,
    profile: "region",
    footprint,
    boundary: null,
    map: { sourceAreaId: input.areaId, sourceRevision: 1, refinementLevel: 1 },
  };
  domain.world.fields.push({
    id: "captured",
    areaId,
    layerId: "elevation",
    algorithm: "supplied",
    input: true,
    source: { kind: "operation", id: "supplied" },
    samples: result.state.surface.active.length,
    channels: Object.keys(result.state.surface.channels),
    footprint,
    spaceId: result.state.surface.scope.spaceId,
  });
  domain.numerical.captured = result.state.surface;
  const request = { areaId, domains: ["physical", "magic"], quality: "draft" as const, seed: 73 },
    prepared = prepareRegionalRefinement(domain, request);
  expect(prepared.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  // The regional sequence on the runner, as `refineRegionalMap` runs it.
  const initial = regionalInitialState(prepared.source, prepared.input),
    refined = await new MapRunner(prepared.input.configuration!, prepared.registry).run(initial, {
      seed: "73",
      seedScope: areaId,
    });
  refined.state.publications = atlasGenerationModules.publications(
    prepared.input,
    refined.state.domain.world
  );
  delete refined.state.physical;
  const snapshot = generationSnapshot(refined, prepared.input, crypto.randomUUID(), original);
  expect(refined.state.history.filter((entry) => entry.ancestry.length)).toEqual([]);
  expect(snapshot.world.areas[input.areaId]).toEqual(original.world.areas[input.areaId]);
  expect(snapshot.world.epochs).toEqual(original.world.epochs);
  expect(snapshot.world.features).toMatchObject(original.world.features);
  const published = numericalValues(snapshot),
    parentValues = numericalValues(original);
  for (const field of original.world.fields)
    expect(published[field.id].channels).toEqual(parentValues[field.id].channels);
  expect(snapshot.world.fields.some((field) => field.areaId === areaId)).toBe(true);
  // The published field, not the captured input.
  const elevation = snapshot.world.fields.find(
    (field) => field.areaId === areaId && !field.input && field.channels?.includes("elevation")
  )!;
  expect(snapshot.numerical[elevation.id].scope.resolution).toBeLessThan(1000);
});

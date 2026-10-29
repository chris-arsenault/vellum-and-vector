import { expect, it } from "vitest";
import { createGrid, rectangle, resampleChannels } from "@atlas/domain";
import {
  prepareAtlasGeneration,
  atlasGenerationModules,
  type GenerationState,
  generationSnapshot,
} from "@atlas/generation";
import { MapRunner } from "../../packages/generation/src/mapRunner";
import { constructedWorld } from "./constructedWorldFixture";
import { numericalValues, snapshotCopy } from "./testSupport/snapshotCopy";

it("publishes conditioned regional geography from supplied parent products without changing the parent", async () => {
  const { input, result } = constructedWorld(),
    parent = generationSnapshot(result, input, crypto.randomUUID()),
    original = snapshotCopy(parent),
    domain = snapshotCopy(parent),
    areaId = crypto.randomUUID(),
    footprint = rectangle([2200, 100, 3800, 900]);
  domain.world.areas[areaId] = {
    ...structuredClone(domain.world.areas[input.areaId]),
    id: areaId,
    name: "A closer look",
    parentId: input.areaId,
    profile: "region",
    footprint,
    boundary: {
      version: 1,
      parentId: input.areaId,
      parentVersion: 1,
      epochs: [],
      crossings: [],
      samples: [{ point: { x: 2200, y: 500, z: 0 }, values: { elevation: 9999 } }],
    },
  };
  domain.scope = { ...domain.scope, areaId, footprint, resolution: 200 };
  const surface = createGrid("regional-surface", domain.scope, 9, 5);
  resampleChannels(result.state.surface, surface);
  const prepared = prepareAtlasGeneration(domain, {
    areaId,
    domains: ["physical", "magic", "built", "cultural", "political"],
    quality: "draft",
    seed: 73,
  });
  expect(prepared.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const state: GenerationState = {
    domain: prepared.source,
    surface,
    facts: new Set([
      ...Object.keys(surface.channels),
      "canonry:Elevation",
      "canonry:LandscapeHistory",
      "canonry:SedimentSupply",
      "canonry:Geothermal",
      "canonry:Impacts",
    ]),
    history: [],
    publications: atlasGenerationModules.publications(prepared.input, domain.world),
  };
  const refined = await new MapRunner(prepared.input.configuration!, prepared.registry).run(state, {
    seed: "73",
    seedScope: areaId,
  });
  refined.state.publications = atlasGenerationModules.publications(
    prepared.input,
    refined.state.domain.world
  );
  const snapshot = generationSnapshot(refined, prepared.input, crypto.randomUUID(), original);
  expect(refined.state.history.filter((entry) => entry.ancestry.length)).toEqual([]);
  expect(snapshot.world.societies?.[areaId]?.history).toEqual([]);
  expect(snapshot.world.societies?.[areaId]?.communities.every((c) => c.groups.length === 0)).toBe(
    true
  );
  expect(snapshot.world.areas[input.areaId]).toEqual(original.world.areas[input.areaId]);
  expect(snapshot.world.epochs).toEqual(original.world.epochs);
  expect(snapshot.world.features).toMatchObject(original.world.features);
  const published = numericalValues(snapshot),
    parentValues = numericalValues(original);
  for (const field of original.world.fields)
    expect(published[field.id].channels).toEqual(parentValues[field.id].channels);
  expect(snapshot.world.fields.some((field) => field.areaId === areaId)).toBe(true);
  const elevation = snapshot.world.fields.find(
    (field) => field.areaId === areaId && field.channels?.includes("elevation")
  )!;
  expect(snapshot.numerical[elevation.id].scope.resolution).toBeLessThan(1000);
});

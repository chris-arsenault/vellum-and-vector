import { expect, it } from "vitest";
import { generateBand, putChannel } from "@atlas/domain";
import { atlasPublicationDefinitions } from "@atlas/generation";
import { generationSnapshot } from "./generationJobs";
import { constructedWorld } from "./constructedWorldFixture";

it("publishes constructed numerical geography with its units, request and authored identity", () => {
  const { source, input, result } = constructedWorld();
  const feature = {
    id: crypto.randomUUID(),
    areaId: input.areaId,
    name: "Protected point",
    kind: "poi",
    layerId: "pois",
    geometry: { type: "Point" as const, coordinates: [2000, 500] },
    attributes: {},
    relations: [],
    detail: {},
    causes: [],
    protected: true,
    actor: "creator" as const,
    state: "authored" as const,
    generationId: null,
  };
  result.state.domain.world.features[feature.id] = feature;
  const snapshot = generationSnapshot(result, input, crypto.randomUUID(), source);
  expect(snapshot.world.features[feature.id]).toEqual(feature);
  const elevation = snapshot.world.fields.find((field) => field.channels?.includes("elevation"))!;
  expect(Array.from(snapshot.numerical[elevation.id].channels.elevation)).toEqual(
    Array.from(result.state.surface.channels.elevation)
  );
  expect(snapshot.numerical[elevation.id].units.elevation).toBe("metre");
  expect(snapshot.world.generations.at(-1)).toMatchObject({ seed: input.seed });
  expect(source.world.fields).toEqual([]);
});

it("publishes a system's quickening in its magic field rather than attributing it to ecology", () => {
  const { source, input, result } = constructedWorld();
  const magicInput = { ...input, domains: ["magic"] };
  result.state.publications = atlasPublicationDefinitions(magicInput, source.world);
  putChannel(
    result.state.surface,
    "quickening",
    "ratio",
    generateBand(result.state.surface.coverage, "float64", "quickening", () => 0.4)
  );
  const snapshot = generationSnapshot(result, magicInput, crypto.randomUUID(), source);
  const field = snapshot.world.fields.find((field) => field.channels?.includes("quickening"))!;
  expect(field.layerId).toBe("magic");
  expect(Array.from(snapshot.numerical[field.id].channels.quickening)).toEqual(
    new Array(10).fill(0.4)
  );
});

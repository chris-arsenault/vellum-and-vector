import { readFeature, fixtureState, undoWorld } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import type { PopulationGroup } from "@atlas/domain";
import { mapEditingFixture } from "./mapEditingFixture";
import { snapshotCopy } from "./testSupport/snapshotCopy";
import { describedGroups, placeFacts } from "./settlementSurfaceData";

async function residentFixture() {
  const f = await mapEditingFixture();
  const groups: PopulationGroup[] = [
    {
      people: "residents",
      culture: null,
      languages: ["River speech", "Coast speech"],
      namingLanguage: "River speech",
      religions: [],
      practices: [],
      count: 1000,
    },
  ];
  f.current().world.features[f.town].attributes = {
    population: 200,
    communityPopulation: 1000,
    ruralPopulation: 800,
    groups,
  };
  return f;
}

it("keeps mapped group edits, settlement totals, inspection and undo coherent without changing the parent's record", async () => {
  const f = await residentFixture(),
    before = snapshotCopy(f.current()),
    feature = await readFeature(f.id, f.town, f.child);
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...feature,
      attributes: {
        ...feature.attributes,
        population: 1200,
        groups: [
          {
            ...(feature.attributes.groups as PopulationGroup[])[0],
            count: 1200,
            namingLanguage: "Coast speech",
            practices: ["conservation"],
          },
        ],
      },
    },
  });
  const mapped = await readFeature(f.id, f.town, f.child);
  expect(mapped.attributes).toMatchObject({
    population: 240,
    settlementPopulation: 240,
    communityPopulation: 1200,
    ruralPopulation: 960,
    groups: [{ count: 1200, namingLanguage: "Coast speech", practices: ["conservation"] }],
  });
  expect(describedGroups(mapped)?.[0].count).toBe(1200);
  expect(placeFacts(mapped)).toMatchObject({ townsfolk: 240, people: 1200, country: 960 });
  expect((await readFeature(f.id, f.town, f.root)).attributes).toEqual(
    before.world.features[f.town].attributes
  );
  await undoWorld(f.id, fixtureState(f.id).history[0].operationId);
  expect((await readFeature(f.id, f.town, f.child)).attributes).toEqual(feature.attributes);
});

it("updates mapped urban counts and resident groups together while keeping the mapped rural population", async () => {
  const f = await residentFixture(),
    before = snapshotCopy(f.current()),
    feature = await readFeature(f.id, f.town, f.child);
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...feature,
      attributes: { ...feature.attributes, population: 300 },
    },
  });
  expect((await readFeature(f.id, f.town, f.child)).attributes).toMatchObject({
    population: 300,
    communityPopulation: 1100,
    ruralPopulation: 800,
    groups: [{ count: 1100 }],
  });
  expect((await readFeature(f.id, f.town, f.root)).attributes).toEqual(
    before.world.features[f.town].attributes
  );
});

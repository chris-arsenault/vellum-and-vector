import { readFeature, fixtureState, undoWorld } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import type { PopulationGroup, SocietyCommunity, SocietyRegion } from "@atlas/domain";
import { mapEditingFixture } from "./mapEditingFixture";
import { settlementCommunity } from "./settlementSurfaceData";

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
    communityId: "known",
    population: 200,
    communityPopulation: 1000,
    ruralPopulation: 800,
    groups,
  };
  const community: SocietyCommunity = {
    id: "known",
    name: "Known town",
    position: { x: 500, y: 500, z: 0 },
    areaKm2: 1,
    groups: structuredClone(groups),
    founded: "Retained era",
    status: "inhabited",
    protected: false,
    causes: [],
    settlement: { population: 200, peak: 200, recoveryYears: 0 },
    support: {
      capacity: 1500,
      farming: 1000,
      grazing: 300,
      gathering: 100,
      fishing: 100,
      water: 1,
    },
    history: [
      {
        era: "Retained era",
        year: 20,
        population: 1000,
        capacity: 1500,
        settlementPopulation: 200,
        status: "inhabited",
      },
    ],
  };
  const region: SocietyRegion = {
    areaId: f.root,
    spaceId: f.id,
    communities: [community],
    connections: [],
    works: [],
    events: [],
    magic: [],
    history: [],
  };
  f.current().world.societies = { [f.root]: region };
  return f;
}

it("keeps mapped group edits, settlement totals, inspection and undo coherent without changing retained society", async () => {
  const f = await residentFixture(),
    before = structuredClone(f.current()),
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
  const inspected = settlementCommunity(f.current().world, mapped, f.child)!;
  expect(inspected.community.groups[0].count).toBe(1200);
  expect(inspected.community.settlement?.population).toBe(240);
  expect(inspected.community.history).toEqual(
    before.world.societies![f.root].communities[0].history
  );
  expect(f.current().world.societies).toEqual(before.world.societies);
  expect((await readFeature(f.id, f.town, f.root)).attributes).toEqual(
    before.world.features[f.town].attributes
  );
  await undoWorld(f.id, fixtureState(f.id).history[0].operationId);
  expect((await readFeature(f.id, f.town, f.child)).attributes).toEqual(feature.attributes);
});

it("updates mapped urban counts and resident groups together while keeping the mapped rural population", async () => {
  const f = await residentFixture(),
    before = structuredClone(f.current()),
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
  expect(f.current().world.societies).toEqual(before.world.societies);
});

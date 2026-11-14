import { expect, it } from "vitest";
import { columnFields, identityColumn, humanLayers, humanRemains, MapScale } from "@atlas/domain";
import { mapInspectionSections } from "./mapInspectionSections";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";

it("publishes both ground columns, mixed rock, formation and valleys", () => {
  const { world } = publishedMapFixture();
  const land = columnFields.land,
    cut = columnFields.cut;
  const values: Record<string, number> = {
    [land.depth[0]]: MapScale.native(12),
    [land.kind[0]]: 0,
    [land.secondaryKind[0]]: 1,
    [land.secondaryShare[0]]: 0.25,
    [land.strength[0]]: 0.8,
    [land.damage[0]]: 0.2,
    [land.formedMin[0]]: 2,
    [land.formedMax[0]]: 4,
    [cut.depth[0]]: MapScale.native(6),
    [cut.kind[0]]: 1,
    GroundCutShare: 0.4,
    GroundCutDepth: MapScale.native(30),
  };
  const sections = mapInspectionSections(
    world,
    (name) => values[name] ?? 0,
    new Set(Object.keys(values)),
    100
  );
  expect(sections[0].records).toEqual([{ "Share of ground": "40%", Depth: "30 m" }]);
  expect(sections[1].records[0]).toMatchObject({
    Thickness: "12 m",
    Fractured: "20%",
    Formed: "epochs 2–4",
  });
  expect(sections[1].records[0]["Layer, top first"]).toContain("with 25%");
  expect(sections[2]).toMatchObject({
    title: "Under the valley floors",
    records: [{ Thickness: "6 m" }],
  });
});
it("resolves named traditions, population, land use and ruins without viewer generation data", () => {
  const { world } = publishedMapFixture();
  world.entities.language = {
    id: "language",
    name: "Coast speech",
    kind: "language",
    attributes: { traditionKind: "tongue", traditionCode: 7 },
  };
  const values: Record<string, number> = {
    [humanLayers.population]: 20,
    [humanLayers.farmland]: 0.3,
    [humanRemains.builtUp]: 0.1,
    [humanRemains.cover]: 0.5,
    [identityColumn.people[0]]: 10,
    [identityColumn.traditions.Tongue[0]]: 7,
    [identityColumn.age[0]]: 100,
    [identityColumn.hardness[0]]: 0.8,
  };
  const sections = mapInspectionSections(
    world,
    (name) => values[name] ?? 0,
    new Set(Object.keys(values)),
    2e6
  );
  expect(sections[0].records).toContainEqual({
    Fact: "People",
    Value: "20 per km² · about 40 on this cell",
  });
  expect(sections[0].records).toContainEqual({
    Fact: "Ruins",
    Value: "10% of the ground, 50% of them buried or drowned",
  });
  expect(sections[1].records).toEqual([
    {
      Traditions: "tongue: Coast speech",
      "Share of people": "50%",
      Age: "100 years",
      "Holds against change": "80%",
    },
  ]);
});

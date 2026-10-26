import { expect, test, type Page } from "./uiTest";
import type { AtlasFeature, PopulationGroup, SocietyRegion } from "@atlas/domain";
import { canvas, exportMap, generatedWorld, pageErrors, panel } from "./harness";

/** The legend items of a share bar on the inspection surface, by the bar's label. */
function legend(page: Page, label: string) {
  return page.getByRole("img", { name: label, exact: true }).locator("..").getByRole("listitem");
}
function settlementFeature(): AtlasFeature {
  return {
    id: "d467baee-3162-4ea0-a00b-0770e0661a7a",
    areaId: "fixture",
    name: "River town",
    kind: "settlement",
    layerId: "settlements",
    geometry: { type: "Point", coordinates: [2000, 500] },
    attributes: {
      communityId: "town",
      population: 200,
      communityPopulation: 1000,
      ruralPopulation: 800,
      groups: [
        {
          people: "residents",
          culture: null,
          languages: ["River speech", "Coast speech"],
          namingLanguage: "River speech",
          religions: [],
          practices: [],
          count: 1000,
        },
      ],
    },
    relations: [],
    detail: {},
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    causes: [],
  };
}
function societyState(feature: AtlasFeature): SocietyRegion {
  return {
    areaId: "fixture",
    spaceId: "surface",
    connections: [],
    works: [],
    events: [],
    magic: [],
    history: [
      {
        id: "Settlement",
        years: 20,
        before: 900,
        after: 1000,
        births: 150,
        deaths: 50,
        migrated: 0,
        cycles: 2,
        causes: [],
      },
    ],
    communities: [
      {
        id: "town",
        name: feature.name,
        position: { x: 2000, y: 500, z: 0 },
        areaKm2: 4,
        groups: feature.attributes.groups as PopulationGroup[],
        support: {
          capacity: 1500,
          farming: 1000,
          grazing: 300,
          gathering: 100,
          fishing: 100,
          water: 1,
        },
        founded: "Settlement, year 10",
        naming: { language: "River speech", culture: "marches", era: "Settlement, year 10" },
        status: "inhabited",
        protected: false,
        causes: [],
        settlement: { population: 200, peak: 200, recoveryYears: 0 },
        history: [
          {
            era: "Settlement",
            year: 10,
            population: 900,
            capacity: 1200,
            settlementPopulation: 150,
            status: "inhabited",
          },
          {
            era: "Settlement",
            year: 20,
            population: 1000,
            capacity: 1500,
            settlementPopulation: 200,
            status: "inhabited",
          },
        ],
      },
    ],
  };
}
/** A 4 × 1 km world whose only settlement sits at the map centre. */
async function settlementWorld(page: Page, name: string, settlement: AtlasFeature) {
  await generatedWorld(
    page,
    name,
    { features: [settlement], society: societyState(settlement) },
    { width: 4, height: 1 }
  );
  const box = (await canvas(page).boundingBox())!;
  await canvas(page).click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(panel(page).locator("h2")).toHaveText("River town");
}

test("the settlement surface shows the community and its edits reach the export", async ({
  page,
}) => {
  const errors = pageErrors(page);
  const settlement = settlementFeature();
  await settlementWorld(page, "Society authoring", settlement);
  await expect(page.getByTitle("200 settlement residents", { exact: true })).toBeVisible();
  await expect(page.getByTitle("800 rural residents", { exact: true })).toBeVisible();
  await expect(legend(page, "Naming-language use")).toHaveText(["River speech 100.0%"]);
  await page.getByText("Local population history", { exact: true }).click();
  await expect(page.getByRole("cell", { name: "Settlement / 10", exact: true })).toBeVisible();
  await page.getByText("Properties & relationships", { exact: true }).click();
  await page.getByLabel("People in group 1", { exact: true }).fill("1200");
  await page
    .getByRole("combobox", { name: "Naming language", exact: true })
    .selectOption("Coast speech");
  await page
    .getByLabel("Practices (comma separated)", { exact: true })
    .fill("conservation, cultivation");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await page.getByText("Place environmental work", { exact: true }).click();
  await page.getByRole("combobox", { name: "Work", exact: true }).selectOption("conservation");
  await page.getByLabel("Radius (metres)", { exact: true }).fill("250");
  await page.getByRole("button", { name: "Place work", exact: true }).click();
  const exported = await exportMap(page);
  expect(
    exported.features.find((f: { id: string }) => f.id === settlement.id).properties
  ).toMatchObject({
    population: 240,
    communityPopulation: 1200,
    ruralPopulation: 960,
    groups: [
      { count: 1200, namingLanguage: "Coast speech", practices: ["conservation", "cultivation"] },
    ],
  });
  expect(
    exported.features.find(
      (f: { properties: { kind: string } }) => f.properties.kind === "conservation"
    ).properties
  ).toMatchObject({ workKind: "conservation", layerId: "landUse", radius: 250, maintained: true });
  expect(errors).toEqual([]);
});

test("mixed language shares are shown, edited and kept without flattening the population", async ({
  page,
}) => {
  const settlement = settlementFeature();
  const group = (settlement.attributes.groups as PopulationGroup[])[0];
  group.languageShares = {
    "River speech": { knowledge: 1, use: 0.75 },
    "Coast speech": { knowledge: 0.4, use: 0.25 },
  };
  await settlementWorld(page, "Mixed languages", settlement);
  await expect(legend(page, "Languages residents know")).toHaveText([
    "River speech 100.0%",
    "Coast speech 40.0%",
  ]);
  await page.getByText("Properties & relationships", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Naming language", exact: true })).toHaveValue(
    "mixed"
  );
  await page.getByLabel("People in group 1", { exact: true }).fill("1200");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(legend(page, "Naming-language use")).toHaveText([
    "River speech 75.0%",
    "Coast speech 25.0%",
  ]);
  await page.getByLabel("Know Coast speech (%)", { exact: true }).fill("60");
  await page.getByLabel("Naming use Coast speech (%)", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(panel(page).locator("h2")).toHaveText("River town");
  const exported = await exportMap(page);
  expect(
    exported.features.find((f: { id: string }) => f.id === settlement.id).properties.groups
  ).toMatchObject([
    {
      count: 1200,
      languageShares: {
        "River speech": { knowledge: 1, use: 0.6 },
        "Coast speech": { knowledge: 0.6, use: 0.4 },
      },
    },
  ]);
});

import { expect, test } from "./uiTest";
import type { AtlasGenerationInput } from "@atlas/generation";
import {
  canvas,
  openFixtureMap,
  closeDrawer,
  installGenerationFixture,
  openRegistry,
  pageErrors,
  panel,
  pointFeature,
  status,
  tool,
} from "./harness";
import { setupStep, tuneGeneration } from "./generationSetup";

const km = 1000;
const id = "6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c";
/** What the generator leaves behind: the record it sited and the feature it published for it. */
const sited = {
  id,
  name: "Kibo",
  kind: "volcanic-mountain",
  geometry: { type: "Point" as const, coordinates: [800 * km, 500 * km] },
  parameters: { summit: 5895, prominence: 4000, baseRadius: 30 },
  emplacedAtEpoch: 1,
  origin: "generated" as const,
};
const published = {
  ...pointFeature(
    "Kibo",
    "landmark",
    "geology",
    {
      landmarkKind: "volcanic-mountain",
      causeId: `landmark:${id}`,
      origin: "generated",
      signature: "realized",
      summit: 5890,
      summitTarget: 5895,
      prominence: 3990,
      prominenceTarget: 4000,
      maintenance: 640,
    },
    [800 * km, 500 * km]
  ),
  id,
};

/** A magic landmark the run sited: a Fire wellspring on the magic layer with its source held. */
const wellspringId = "2a7b9c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const wellspring = {
  id: wellspringId,
  name: "Emberwell",
  kind: "fire-wellspring",
  geometry: { type: "Point" as const, coordinates: [400 * km, 300 * km] },
  parameters: { intensity: 900, reach: 60 },
  emplacedAtEpoch: 0,
  origin: "generated" as const,
};
const wellspringFeature = {
  ...pointFeature(
    "Emberwell",
    "landmark",
    "magic",
    {
      landmarkKind: "fire-wellspring",
      causeId: `landmark:${wellspringId}`,
      origin: "generated",
      system: "fire",
      signature: "realized",
      intensity: 905,
      intensityTarget: 900,
      sourceStrength: 905,
      maintenance: 0,
    },
    [400 * km, 300 * km]
  ),
  id: wellspringId,
};

test("generated physical and magic landmarks open as information rather than editing forms", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await openFixtureMap(
    page,
    "Landmark inspection",
    { landmarks: [sited, wellspring], features: [published, wellspringFeature] },
    { width: 2000, height: 1000 }
  );
  await openRegistry(page);
  await page.getByLabel("Search registry").fill("Kibo");
  await page.getByLabel("Show Kibo on map").click();
  await expect(panel(page).getByRole("heading", { name: "Kibo", exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("5,890");
  await expect(page.getByLabel("Landmark name")).toHaveCount(0);
  await page.getByLabel("Search registry").fill("Emberwell");
  await page.getByLabel("Show Emberwell on map").click();
  await expect(panel(page).getByRole("heading", { name: "Emberwell", exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("905");
  await expect(panel(page).getByRole("textbox")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("landmarks are a generation count, sited by the run, then edited and removed from the result @deferred-authoring", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await installGenerationFixture(page, {
    landmarks: [sited, wellspring],
    features: [published, wellspringFeature],
  });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Landmark atlas");
  await page.getByLabel("Width · km").fill("2000");
  await page.getByLabel("Height · km").fill("1000");
  await page.getByLabel("Detail level").selectOption("draft");

  // The count is a generator setting; the step says the run sites them.
  await tuneGeneration(page, "Major landmarks");
  const count = page.getByLabel("Major landscape landmarks · count", { exact: true });
  await expect(count).toHaveValue("4");
  await count.fill("2");
  await expect(page.getByLabel("Major magic landmarks · count", { exact: true })).toHaveValue("3");
  await expect(page.locator("main")).toContainText("No landmark stands in this extent yet");
  await setupStep(page, /Review & generate/).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await expect(status(page)).toContainText("Revision 3");
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.parameters).toMatchObject({ landscapeLandmarks: 2 });

  // Nothing is placed by hand: the terrain palette carries no landmark tool.
  await expect(page.getByRole("toolbar", { name: "Map tools" })).toBeVisible();
  await expect(tool(page, "Place landmark")).toHaveCount(0);
  await expect(tool(page, "Draw landmark path")).toHaveCount(0);

  // One registry row per landmark, typed by its kind, carrying target and measured values.
  await openRegistry(page);
  const registry = page.getByLabel("World feature registry");
  await page.getByLabel("Search registry").fill("Kibo");
  await expect(registry.locator("tbody tr")).toHaveCount(1);
  await expect(registry.locator("tbody tr").first()).toContainText("Volcanic mountain");
  // A magic landmark is one row too, typed by its kind on the magic layer.
  await page.getByLabel("Search registry").fill("Emberwell");
  await expect(registry.locator("tbody tr")).toHaveCount(1);
  await expect(registry.locator("tbody tr").first()).toContainText("Great wellspring");
  await page.getByLabel("Search registry").fill("Kibo");
  await page.getByLabel("Show Kibo on map").click();
  await closeDrawer(page);

  // Selecting the landmark opens its record for editing after generation.
  await expect(panel(page)).toContainText("Landmarks in this landscape");
  await expect(panel(page).getByRole("heading", { name: "Edit Kibo" })).toBeVisible();
  await expect(panel(page)).toContainText("summit elevation 5895 m");
  await page.getByLabel("Landmark name").fill("Kibo Peak");
  await page.getByLabel("Summit elevation · m").fill("6000");
  await page.getByRole("button", { name: "Save landmark", exact: true }).click();
  await expect(status(page)).toContainText("Revision 4");
  await expect(panel(page)).toContainText("Kibo Peak");
  await expect(panel(page)).toContainText("summit elevation 6000 m");

  await panel(page).getByRole("button", { name: "Remove landmark", exact: true }).first().click();
  await expect(status(page)).toContainText("Revision 5");
  await expect(panel(page)).not.toContainText("Kibo Peak");
  await expect(panel(page)).toContainText("Emberwell");
  expect(errors).toEqual([]);
});

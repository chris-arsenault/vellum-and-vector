import { expect, test } from "./uiTest";
import { chooseOutline, exportMap, openFixtureMap, openSavedFixture, pageErrors } from "./harness";

test("server view preferences save without a Save action", async ({ page }) => {
  const reference = await openFixtureMap(page);
  await page.goto("/tests/fixtureMap.html");
  await page.waitForFunction(() => typeof window.openServerSaveFixture === "function");
  await page.evaluate((reference) => window.openServerSaveFixture(reference), reference);
  await expect(page.getByRole("button", { name: "Save map", exact: true })).toHaveCount(0);
  await chooseOutline(page, "Kept on server");
  await expect
    .poll(async () => {
      const saved = await page.evaluate(() => window.savedFixtureView());
      return saved.navigation.regions.map((region) => region.name);
    })
    .toContain("Kept on server");
  await expect(page.locator(".map-storage [role=status]")).toHaveText("Stored on server");
  await page.reload();
  await page.waitForFunction(() => typeof window.openServerSaveFixture === "function");
  await page.evaluate((reference) => window.openServerSaveFixture(reference), reference);
  await expect(page.getByRole("heading", { name: "Kept on server", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.generationCalls)).toEqual([]);
});

test("@generation closing progress keeps the job and a completed job opens its map", async ({
  page,
}) => {
  const reference = await openFixtureMap(page);
  await page.evaluate((reference) => {
    window.generationFixtureJobs = [
      {
        jobId: "running-region",
        state: "running",
        step: "Epoch 2",
        progress: 0.5,
        result: null,
        message: null,
        details: {
          name: "Coastal region",
          parent: reference,
          startedAt: "2026-11-15T00:00:00Z",
          finishedAt: null,
          elapsedSeconds: 12,
          epochs: [{ name: "Epoch 1", seconds: 8 }],
        },
      },
      {
        jobId: "completed-region",
        state: "completed",
        step: "Map published",
        progress: 1,
        result: reference,
        message: null,
      },
    ];
  }, reference);
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page.getByText("Generation jobs", { exact: true }).first().click();
  await page.getByRole("button", { name: /Coastal region/ }).click();
  await expect(page.getByText("Elapsed: 12 seconds", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close progress", exact: true }).click();
  expect(await page.evaluate(() => window.generationCalls)).not.toContain("cancel");
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page.getByText("Generation jobs", { exact: true }).first().click();
  await page.getByRole("button", { name: /Map published.*Open map/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
});

test("local saves retain GIS geography, selected regions and appearance across reload", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await openFixtureMap(page);
  const before = await exportMap(page);
  await chooseOutline(page, "Saved reach");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".map-storage [role=status]")).toHaveText("Saved");
  await page.reload();
  await openSavedFixture(page);
  await expect(page.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
  expect(await exportMap(page)).toEqual(before);
  expect(await page.evaluate(() => window.generationCalls)).toEqual([]);
  expect(errors).toEqual([]);
});

test("@generation interrupted refinement is found from its world and resumes explicitly", async ({
  page,
}) => {
  const reference = await openFixtureMap(page);
  await page.evaluate((parent) => {
    window.generationFixtureJobs = [
      {
        jobId: "interrupted-region",
        state: "interrupted",
        step: "Interrupted by host restart",
        progress: null,
        result: null,
        message: null,
        recovery: { checkpoint: "Regional development round 1 complete", problem: null },
        details: {
          name: "Abandoned coast",
          parent,
          startedAt: "2026-11-15T00:00:00Z",
          finishedAt: null,
          elapsedSeconds: 35,
          epochs: [],
        },
      },
    ];
  }, reference);
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page.getByRole("button", { name: /Regions and jobs for Published island/ }).click();
  await expect(page.getByText("Resume from: Regional development round 1 complete")).toBeVisible();
  expect(await page.evaluate(() => window.generationCalls)).not.toContain("resume");
  await page.getByRole("button", { name: "Resume generation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Generation job" })).toContainText(
    "Resuming latest checkpoint"
  );
  expect(
    await page.evaluate(() => window.generationCalls.filter((call) => call === "resume"))
  ).toHaveLength(1);
});

test("deleting the open saved map removes it from the library across reload", async ({ page }) => {
  await openFixtureMap(page);
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page.getByRole("button", { name: /^Delete Published island/ }).click();
  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toContainText("Independent children remain accessible");
  await prompt.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Published island/ })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await expect(page.getByText("No worlds yet.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.generationCalls)).not.toContain("create");
});

test("another tab opens the explicit save while working regions stay independent", async ({
  page,
  context,
}) => {
  await openFixtureMap(page);
  await chooseOutline(page, "Saved reach");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".map-storage [role=status]")).toHaveText("Saved");
  const second = await context.newPage();
  try {
    await second.goto("/");
    await openSavedFixture(second);
    await expect(second.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
    await page
      .getByRole("region", { name: "Map regions", exact: true })
      .getByText("Region details", { exact: true })
      .click();
    await page.getByLabel("Rename region", { exact: true }).fill("This tab only");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.locator(".map-storage [role=status]")).toHaveText("Unsaved changes");
    await expect(second.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
    await page.reload();
    await openSavedFixture(page);
    await expect(page.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
  } finally {
    await second.close();
  }
});

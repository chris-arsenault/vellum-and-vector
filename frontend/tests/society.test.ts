import { expect, test } from "@playwright/test";
import type { AtlasFeature } from "@atlas/domain";
import { readFile } from "node:fs/promises";
import { installGenerationFixture } from "./generationFixture";

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
      population: 1000,
      groups: [
        {
          people: "residents",
          culture: null,
          languages: [],
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
test("authors population groups and places a located work through the inspector", async ({
  page,
}) => {
  const settlement = settlementFeature();
  await installGenerationFixture(page, false, false, false, [settlement]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Society authoring");
  await page.getByLabel("Width · km").fill("4");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  const canvas = page.getByRole("application", { name: "World map canvas" });
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator(".right-panel h2")).toHaveText("River town");
  await page.getByText("Properties & relationships", { exact: true }).click();
  await page.getByLabel("People in group 1", { exact: true }).fill("1200");
  await page
    .getByLabel("Practices (comma separated)", { exact: true })
    .fill("conservation, cultivation");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await page.getByText("Place environmental work", { exact: true }).click();
  await page.getByRole("combobox", { name: "Work", exact: true }).selectOption("conservation");
  await page.getByLabel("Radius (metres)", { exact: true }).fill("250");
  await page.getByRole("button", { name: "Place work", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(
    exported.features.find((f: { id: string }) => f.id === settlement.id).properties
  ).toMatchObject({
    population: 1200,
    groups: [{ count: 1200, practices: ["conservation", "cultivation"] }],
  });
  expect(
    exported.features.find(
      (f: { properties: { kind: string } }) => f.properties.kind === "societyWork"
    ).properties
  ).toMatchObject({
    workKind: "conservation",
    radius: 250,
    maintained: true,
  });
  expect(errors).toEqual([]);
});

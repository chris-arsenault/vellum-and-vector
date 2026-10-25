import { expect, test } from "@playwright/test";
import { canvas, createWorld, exportMap, pageErrors, tool } from "./harness";

/**
 * The one journey through the real generation worker: a building interior laid out in its
 * located space. Every other journey stubs the worker; the generation itself is covered by
 * the node generation tests.
 */
test("the bundled worker lays out a building interior and publishes its furnishings", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await createWorld(page, "Worker smoke");
  await tool(page, "Draw region rectangle").click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 480, { steps: 8 });
  await page.mouse.up();
  await page.getByLabel("Develop as").selectOption("site");
  await page.getByLabel("Place name").fill("Town");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Town");
  await page.getByLabel("Working layer").selectOption("places");
  await tool(page, "Draw building").click();
  await page.getByLabel("Feature name").fill("Hall");
  await canvas(page).click({ position: { x: 300, y: 250 } });
  await canvas(page).click({ position: { x: 600, y: 250 } });
  await canvas(page).click({ position: { x: 600, y: 550 } });
  await canvas(page).dblclick({ position: { x: 300, y: 550 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Hall");
  await page.getByRole("button", { name: "Refine this footprint", exact: true }).click();
  await expect(page.getByLabel("Develop as")).toHaveValue("interior");
  await page.getByLabel("Place name").fill("Hall interior");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Hall interior");
  await expect(page.getByLabel("Working layer")).toHaveValue("interior");
  await tool(page, "Draw room").click();
  await page.getByLabel("Feature name").fill("Great room");
  await canvas(page).click({ position: { x: 500, y: 250 } });
  await canvas(page).click({ position: { x: 650, y: 250 } });
  await canvas(page).dblclick({ position: { x: 650, y: 350 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Great room");
  const data = await exportMap(page),
    room = data.features.find(
      (feature: { properties: { kind: string } }) => feature.properties.kind === "room"
    ),
    building = data.features.find(
      (feature: { properties: { kind: string } }) => feature.properties.kind === "building"
    );
  expect(room.properties.spaceId).not.toEqual(building.properties.spaceId);
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed", {
    timeout: 60000,
  });
  const completed = await exportMap(page);
  expect(
    completed.features.some(
      (feature: { properties: { kind: string } }) => feature.properties.kind === "furniture"
    )
  ).toBe(true);
  expect(errors).toEqual([]);
});

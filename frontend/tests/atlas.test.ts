import { test, expect, type Page } from "@playwright/test";

test("session world, generation, skipped refinement, editing and located template", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const serviceRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/(api|mcp)(\/|$)/.test(new URL(request.url()).pathname))
      serviceRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByLabel("World name").fill("Test atlas");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByLabel("Communities & distributions", { exact: true }).check();
  await page.getByLabel("Territory & claims", { exact: true }).check();
  await page.getByRole("button", { name: "Generate selected domains" }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed", {
    timeout: 180000,
  });
  await page.screenshot({ path: "test-results/atlas-world.png" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("View preset").selectOption("political");
  await page.getByLabel("View preset").selectOption("cultural");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Field visualization").selectOption("flow");
  await page.getByLabel("Field visualization").selectOption("temperature");
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await createArea(page, "Borderlands", "region", 1000, 1000, 20000, 20000);
  await page.getByLabel("Detail level").scrollIntoViewIfNeeded();
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains" }).click();
  await expect(page.locator(".job-row")).toHaveCount(2);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed", {
    timeout: 180000,
  });
  await page.screenshot({ path: "test-results/atlas-region.png" });
  await createArea(page, "Harbor", "site", 2000, 2000, 1000, 1000);
  await page.getByRole("toolbar").getByRole("button", { name: "Place point", exact: true }).click();
  await page.getByLabel("Feature name").fill("Old well");
  const canvas = page.getByRole("application", { name: "World map canvas" });
  await canvas.click({ position: { x: 300, y: 300 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Old well");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const template = page.getByRole("img", { name: "Template room drawing canvas" });
  const box = await template.boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 100, box!.y + 100);
  await page.mouse.up();
  await page.getByLabel("Template name").fill("Tavern plan");
  await page.getByLabel("Generate connected walls and furnishings after placement").check();
  await page.getByRole("button", { name: "Save reusable template" }).click();
  await expect(page.getByRole("heading", { name: "Tavern plan · v1" })).toBeVisible();
  await page.getByRole("button", { name: "Place Tavern plan on map", exact: true }).click();
  await canvas.click({ position: { x: 350, y: 350 } });
  await expect(page.locator(".job-row")).toHaveCount(3);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed", { timeout: 90000 });
  await page.locator(".area-row").filter({ hasText: "Tavern plan" }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Tavern plan");
  await expect(page.locator(".breadcrumbs")).not.toContainText("local");
  await page.screenshot({ path: "test-results/atlas-interior.png" });
  await page.reload();
  await expect(page.getByLabel("World name")).toBeVisible();
  await expect(page.getByText("This session lives in this tab.", { exact: false })).toBeVisible();
  expect(serviceRequests).toEqual([]);
  expect(errors).toEqual([]);
});

async function createArea(
  page: Page,
  name: string,
  profile: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Draw region rectangle", exact: true })
    .click();
  const panel = page.locator(".right-panel");
  await panel.getByLabel("Develop as").selectOption(profile);
  await panel.getByLabel("Place name", { exact: true }).fill(name);
  await panel.getByText("Enter a precise extent", { exact: true }).click();
  await panel.getByLabel("East · m", { exact: true }).fill(String(x));
  await panel.getByLabel("North · m", { exact: true }).fill(String(y));
  await panel.getByLabel("Width · m", { exact: true }).fill(String(width));
  await panel.getByLabel("Height · m", { exact: true }).fill(String(height));
  await page.getByRole("button", { name: "Use entered extent", exact: true }).click();
  await page.getByRole("button", { name: "Create mapped area" }).click();
  await expect(page.locator(".breadcrumbs")).toContainText(name);
}

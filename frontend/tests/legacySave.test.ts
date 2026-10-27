import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { test, expect } from "./uiTest";
import { exportMap, pageErrors } from "./harness";

test("a released snapshot save imports samples, completed history and successive undo states", async ({
  page,
}) => {
  const errors = pageErrors(page);
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./legacySaveFixture.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "LegacySave",
    platform: "browser",
    logLevel: "silent",
  });
  await page.goto("/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const saved = await page.evaluate(() =>
    (
      window as unknown as {
        LegacySave: {
          installLegacySave(): Promise<{ id: string; areaId: string; maximum: number }>;
        };
      }
    ).LegacySave.installLegacySave()
  );
  await page.reload();
  const open = async () => {
    await page.getByRole("button", { name: "Saved maps", exact: true }).click();
    await page.getByRole("button", { name: /^Legacy atlas Revision/ }).click();
    await expect(page.getByRole("dialog", { name: "Saved maps", exact: true })).toHaveCount(0);
  };
  await open();
  await expect(page.locator(".breadcrumbs")).toContainText("Renamed legacy root");
  expect(saved.maximum).toBeGreaterThan(140);
  await inspectLegacyField(page, saved.areaId, saved.maximum);
  expect((await exportMap(page)).areas.map((area: { id: string }) => area.id)).toContain(
    saved.areaId
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Legacy atlas");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await open();
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
  await page.reload();
  await open();
  expect((await exportMap(page)).name).toBe("Legacy atlas");
  await inspectLegacyField(page, saved.areaId, saved.maximum);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Legacy atlas");
  expect(errors).toEqual([]);
});
async function inspectLegacyField(
  page: import("@playwright/test").Page,
  areaId: string,
  maximum: number
) {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("analysis");
  await page
    .getByRole("combobox", { name: "Operation", exact: true })
    .selectOption("fieldStatistics");
  await page.getByLabel("Field channel", { exact: true }).fill("elevation");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  const panel = page.locator(".right-panel");
  await expect(
    panel
      .locator("dl div")
      .filter({ has: page.getByText("minimum", { exact: true }) })
      .locator("dd")
  ).toHaveText("100");
  await expect(
    panel
      .locator("dl div")
      .filter({ has: page.getByText("maximum", { exact: true }) })
      .locator("dd")
  ).toHaveText(String(Number(maximum.toFixed(3))));
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("history");
  await page.getByRole("combobox", { name: "Mapped area", exact: true }).selectOption(areaId);
  await panel.getByText("Present geography", { exact: true }).click();
  await expect(panel.getByText("Retained formation history", { exact: true })).toBeVisible();
}

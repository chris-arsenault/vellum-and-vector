import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { FeatureCollection, Geometry } from "geojson";

test("real Draft geography exposes sites courses footprints and named features", async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Geographic atlas");
  await page.getByLabel("Width · km").fill("2000");
  await page.getByLabel("Height · km").fill("1000");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByLabel("Detail level", { exact: true }).selectOption("draft");
  await page.getByLabel("Communities & distributions", { exact: true }).check();
  await page.getByLabel("Territory & claims", { exact: true }).check();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed", {
    timeout: 180000,
  });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  const collection = JSON.parse(
    await readFile((await (await pending).path())!, "utf8")
  ) as FeatureCollection<Geometry>;
  const features = collection.features;
  expect(features.length).toBeGreaterThan(0);
  expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
  const magic = features.filter((f) => f.properties?.layerId === "magic");
  const sites = new Set(["core", "spring", "vent", "well", "locus", "rogue", "breach"]);
  const located = magic.filter((f) => sites.has(String(f.properties?.rule)));
  expect(located.length).toBeGreaterThan(0);
  for (const feature of located) {
    expect(feature.geometry.type).toBe("Point");
    expect(feature.properties?.footprint).toBeTruthy();
  }
  for (const feature of features.filter((f) => f.properties?.kind === "waterfall"))
    expect(feature.geometry.type).toBe("Point");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.locator(".feature-themes > summary")).toContainText(
    `${features.length.toLocaleString()} in this map`
  );
  await page.screenshot({ path: "test-results/feature-geography-layers.png" });
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await page.getByLabel("Search registry").fill(String(located[0].properties?.name));
  await expect(page.locator(".registry-table tbody tr").first()).toContainText(
    String(located[0].properties?.name)
  );
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await page.screenshot({ path: "test-results/feature-geography-world.png" });
  expect(errors).toEqual([]);
});

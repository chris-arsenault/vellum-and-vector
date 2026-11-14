import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
export { openFixtureMap, openSavedFixture } from "./preparedMaps";
export const canvas = (page: Page) => page.getByRole("application", { name: "World map canvas" });
export function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
export async function exportMap(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
export async function chooseOutline(page: Page, name: string) {
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  await regions.getByRole("button", { name: "Choose a region", exact: true }).click();
  await canvas(page).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await regions.getByLabel("Region name", { exact: true }).fill(name);
  await regions.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(regions.getByRole("heading", { name, exact: true })).toBeVisible();
}

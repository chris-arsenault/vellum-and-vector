import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { NIL, v5 } from "uuid";
export { fixtureChild, openFixtureMap, openSavedFixture } from "./preparedMaps";
/** A fixture record's identity from its name, as the Rust fixture makes it
 * (`atlas_map::Id::from_name`: UUID v5 of the name in the nil namespace). */
export const fixtureId = (name: string) => v5(name, NIL);
/** A ground map's underground space, named in its surface space as the Rust side makes it
 * (`Id::v5(surface, b"underground")`). */
export const undergroundSpace = (surface: string) => v5("underground", surface);
export const canvas = (page: Page) => page.getByRole("application", { name: "World map canvas" });
/** The Maps panel's tree of worlds and refined maps, opened if it is not already. */
export async function mapTree(page: Page) {
  const tab = page
    .getByRole("navigation", { name: "Workspace panels" })
    .getByRole("button", { name: "Maps", exact: true });
  if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
  return page.getByRole("navigation", { name: "Maps", exact: true });
}
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
  await page.getByRole("button", { name: "Click boundary", exact: true }).click();
  await canvas(page).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await regions.getByLabel("Region name", { exact: true }).fill(name);
  await regions.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(regions.getByRole("heading", { name, exact: true })).toBeVisible();
}

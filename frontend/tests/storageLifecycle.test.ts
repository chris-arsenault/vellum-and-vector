import { test, expect, type Page } from "./uiTest";
import { generatedWorld, generate, pageErrors } from "./harness";

async function resourceNames(page: Page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const resources = await (
      await root.getDirectoryHandle("atlas-resources")
    ).getDirectoryHandle("resources");
    const names: string[] = [];
    for await (const name of (
      resources as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
    ).keys())
      names.push(name);
    return names.sort();
  });
}
async function orphanDirectories(page: Page, create = false) {
  return page.evaluate(async (create) => {
    const root = await navigator.storage.getDirectory();
    const parents = ["atlas-work", "atlas-exports", "atlas-catalogs", "atlas-resources/resources"];
    const found: string[] = [];
    for (const path of parents) {
      let directory = root;
      try {
        for (const name of path.split("/"))
          directory = await directory.getDirectoryHandle(name, { create });
        await directory.getDirectoryHandle("abandoned-test-work", { create });
        found.push(path);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
    }
    return found;
  }, create);
}
async function openSaved(page: Page) {
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Storage lifetime Revision/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Saved maps", exact: true })).toHaveCount(0);
}
test("cleanup protects live tabs and saved undo inputs, then reclaims abandoned work @deferred-authoring", async ({
  page,
  context,
}) => {
  const errors = pageErrors(page);
  await generatedWorld(page, "Storage lifetime", { fields: true });
  const firstGeneration = await resourceNames(page);
  await page.getByText("Generate or regenerate systems", { exact: true }).click();
  await generate(page);
  const bothGenerations = await resourceNames(page);
  expect(bothGenerations.length).toBeGreaterThan(firstGeneration.length);
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
  expect(await orphanDirectories(page, true)).toHaveLength(4);
  const second = await context.newPage();
  const otherErrors = pageErrors(second);
  try {
    await second.goto("/");
    await openSaved(second);
    expect(await orphanDirectories(second)).toHaveLength(4);
    await page.close();
    await second.reload();
    await openSaved(second);
    expect(await orphanDirectories(second)).toEqual([]);
    expect(await resourceNames(second)).toEqual(bothGenerations);
    await second.getByRole("button", { name: "Undo", exact: true }).click();
    await second.getByRole("button", { name: "Library", exact: true }).click();
    await second.getByRole("combobox", { name: /^Workspace/ }).selectOption("analysis");
    await second
      .getByRole("combobox", { name: "Operation", exact: true })
      .selectOption("fieldStatistics");
    await second.getByLabel("Field channel", { exact: true }).fill("elevation");
    await second.getByRole("button", { name: "Run analysis", exact: true }).click();
    await expect(
      second
        .locator(".right-panel dl div")
        .filter({ has: second.getByText("maximum", { exact: true }) })
        .locator("dd")
    ).toHaveText("15");
    expect([...errors, ...otherErrors]).toEqual([]);
  } finally {
    await second.close();
  }
});

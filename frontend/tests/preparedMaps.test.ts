import { expect, test } from "./uiTest";
import { canvas, tool, chooseOutline, exportMap, openFixtureMap, pointFeature } from "./harness";
import { execFileSync } from "node:child_process";

test("reuses completed map resources while keeping each scenario copy independent", async ({
  page,
  preparedMaps,
}) => {
  const fixture = { numerical: true };
  const original = await openFixtureMap(page, "First copy", {
    ...fixture,
    features: [pointFeature("First marker", "waterfall", "geology")],
  });
  const before = await exportMap(page);
  const sha =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await expect(page.getByLabel("Application build")).toHaveText(`Build ${sha.slice(0, 7)}`);
  await expect(page.getByLabel("Application build")).toHaveAttribute(
    "title",
    `Application build ${sha}`
  );
  await tool(page, "Inspect cell").click();
  await canvas(page).click();
  const inspection = page.locator(".cell-inspection"),
    elevation = inspection
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: "elevation", exact: true }) });
  await expect(elevation.getByRole("cell").last()).toHaveText("metre");
  const index = Number(
    (await inspection.locator(".cell-data h3").first().innerText()).match(/^Cell (\d+)/)![1]
  );
  await expect(elevation.getByRole("cell").first()).toHaveText(String(index % 16));
  await inspection.getByRole("searchbox", { name: "Filter channels" }).fill("water");
  await expect(inspection.getByRole("rowheader", { name: "water", exact: true })).toBeVisible();
  await expect(elevation).toHaveCount(0);
  await chooseOutline(page, "Only in this copy");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");

  const next = await openFixtureMap(page, "Independent copy", fixture);
  expect(next.id).toBe(original.id);
  const restored = await exportMap(page);
  expect(restored.areas).toEqual(before.areas);
  expect(restored.regions).toEqual([]);
  expect(restored.features).toEqual([]);
  expect(await page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  const archive = await preparedMaps.get(fixture, {});
  const expected = archive.files.filter((file) => file.path[0] === "atlas-resources");
  expect(expected.length).toBeGreaterThan(0);
  const actual = await page.evaluate(
    async (paths) => {
      const root = await navigator.storage.getDirectory();
      return Promise.all(
        paths.map(async (path) => {
          let directory = root;
          for (const part of path.slice(0, -1))
            directory = await directory.getDirectoryHandle(part);
          const handle = await directory.getFileHandle(path.at(-1)!);
          const file = await handle.getFile();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
        })
      );
    },
    expected.map((file) => file.path)
  );
  expect(actual).toEqual(expected.map((file) => file.data));
});

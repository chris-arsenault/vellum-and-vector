import { expect, test } from "./uiTest";
import { canvas, createArea, generatedWorld, exportMap, pageErrors } from "./harness";

test("publishes a finer geographic map through the worker while retaining its source map", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await generatedWorld(page, "Worker smoke", { fields: true });
  const parent = await exportMap(page);
  await createArea(page, "River country", [200, 200, 800, 800]);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await page.getByLabel("Regional detail").selectOption("draft");
  await page.getByRole("button", { name: "Generate regional detail", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await expect(canvas(page)).toHaveAttribute("aria-busy", "false");
  const completed = await exportMap(page);
  expect(completed.areas.map((area: { profile: string }) => area.profile).sort()).toEqual([
    "region",
    "world",
  ]);
  expect(completed.areas.find((area: { parentId: string | null }) => !area.parentId)).toEqual(
    parent.areas[0]
  );
  expect(completed.regions).toHaveLength(1);
  expect(errors).toEqual([]);
});

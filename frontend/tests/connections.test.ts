import { test, expect } from "./uiTest";
import { generatedWorld, pointFeature, pageErrors } from "./harness";

test("access features page and search canonical geography and retain the selected attachment", async ({
  page,
}) => {
  const errors = pageErrors(page);
  const features = Array.from({ length: 120 }, (_, i) =>
    pointFeature(`Gate ${String(i).padStart(3, "0")}`, "waterfall", "geology", { elevation: 17 }, [
      1000 + i * 100,
      5000,
    ])
  );
  await generatedWorld(page, "Connected atlas", { features }, { km: 100 });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("connections");
  const from = page.getByRole("group", { name: "From", exact: true }),
    to = page.getByRole("group", { name: "To", exact: true });
  await expect(
    from.getByRole("combobox", { name: "Access feature", exact: true }).locator("option")
  ).toHaveCount(101);
  await from.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(from.getByRole("navigation")).toContainText("Page 2 of 2");
  await from
    .getByRole("combobox", { name: "Access feature", exact: true })
    .selectOption({ label: "Gate 119" });
  await expect(from.getByLabel("X · m", { exact: true })).toHaveValue("12900");
  await expect(from.getByLabel("Z · m", { exact: true })).toHaveValue("17");
  await from.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(from.getByRole("combobox", { name: "Access feature", exact: true })).toHaveValue(
    features[119].id
  );
  await to.getByLabel("Find access feature", { exact: true }).fill("Gate 001");
  await to
    .getByRole("combobox", { name: "Access feature", exact: true })
    .selectOption({ label: "Gate 001" });
  await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("portal");
  await expect(to.getByLabel("X · m", { exact: true })).toHaveValue("1100");
  await expect(page.getByRole("combobox", { name: "Kind", exact: true })).toHaveValue("portal");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  const connection = page.getByRole("combobox", { name: "Connection", exact: true });
  await expect(connection.locator("option")).toHaveCount(2);
  await connection.selectOption({ index: 1 });
  await expect(from.getByLabel("X · m", { exact: true })).toHaveValue("12900");
  await expect(to.getByLabel("X · m", { exact: true })).toHaveValue("1100");
  expect(errors).toEqual([]);
});

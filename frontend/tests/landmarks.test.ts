import { expect, test, type Page } from "./uiTest";
import type { SessionWorld } from "../src/atlasState";
import {
  canvas,
  closeDrawer,
  createWorld,
  openRegistry,
  pageErrors,
  panel,
  status,
  tool,
} from "./harness";

async function storedLandmarks(page: Page, id: string) {
  return page.evaluate(async (worldId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vellum-and-vector-maps", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const transaction = database.transaction("maps");
        const request = transaction.objectStore("maps").get(worldId);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          const data = request.result.data as SessionWorld;
          resolve(
            data.snapshot.world.landmarks.map((landmark) => [
              landmark.name,
              landmark.kind,
              landmark.geometry.type,
              landmark.emplacedAtEpoch,
              landmark.parameters,
            ])
          );
        };
      });
    } finally {
      database.close();
    }
  }, id);
}

test("landmarks are placed, measured, listed, saved and reopened", async ({ page }) => {
  const errors = pageErrors(page);
  await createWorld(page, "Landmark atlas", { km: 2000 });

  await tool(page, "Place landmark").click();
  await expect(panel(page)).toContainText("Landmarks in this landscape");
  await canvas(page).click({ position: { x: 700, y: 500 } });
  await expect(panel(page).getByRole("heading", { name: "Configure this landmark" })).toBeVisible();
  await page
    .getByLabel("Landmark kind")
    .selectOption({ label: "Great mountain · Volcanic mountain" });
  await page.getByLabel("Landmark name").fill("Kibo");
  await page.getByLabel("Summit elevation · m").fill("5895");
  await page.getByLabel("Forms in").selectOption({ label: "Cold age" });
  await page.getByRole("button", { name: "Save landmark", exact: true }).click();
  await expect(status(page)).toContainText("Revision 2");
  await expect(panel(page)).toContainText("Kibo");
  await expect(panel(page)).toContainText("summit elevation 5895 m");
  await expect(panel(page)).toContainText("forms in Cold age");

  await tool(page, "Draw landmark path").click();
  await canvas(page).click({ position: { x: 300, y: 300 } });
  await canvas(page).click({ position: { x: 500, y: 330 } });
  await canvas(page).dblclick({ position: { x: 650, y: 420 } });
  await expect(panel(page).getByRole("heading", { name: "Configure this landmark" })).toBeVisible();
  await expect(page.getByLabel("Landmark kind")).toHaveValue("canyon");
  await page.getByLabel("Landmark name").fill("Long Cut");
  // The measure field carries the catalogue range, so an out-of-range value never reaches the
  // domain; the domain's own diagnostic is covered in src/landmarkAuthoring.test.ts.
  await page.getByLabel("Depth below rim · m").fill("50");
  await page.getByRole("button", { name: "Save landmark", exact: true }).click();
  expect(
    await page
      .getByLabel("Depth below rim · m")
      .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)
  ).toBe(true);
  await expect(status(page)).toContainText("Revision 2");
  await page.getByLabel("Depth below rim · m").fill("1600");
  await page.getByRole("button", { name: "Save landmark", exact: true }).click();
  await expect(status(page)).toContainText("Revision 3");
  await expect(panel(page).getByRole("button", { name: "Edit landmark", exact: true })).toHaveCount(
    2
  );

  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
  const id = await page.getByLabel("World", { exact: true }).inputValue();
  expect(await storedLandmarks(page, id)).toEqual([
    ["Kibo", "volcanic-mountain", "Point", 1, { summit: 5895, prominence: 4000, baseRadius: 30 }],
    ["Long Cut", "canyon", "LineString", 0, { depth: 1600, rimWidth: 15, captureDistance: 150 }],
  ]);

  await page.reload();
  await expect(page.getByLabel("World name")).toBeVisible();
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Saved maps", exact: true })
    .getByRole("button", { name: /^Landmark atlas Revision/ })
    .click();
  await expect(canvas(page)).toBeVisible();
  await tool(page, "Place landmark").click();
  await expect(panel(page)).toContainText("Kibo");
  await expect(panel(page)).toContainText("Long Cut");
  await expect(panel(page)).toContainText("depth below rim 1600 m");

  // The registry shows one landmark row per identity, typed by its catalogue kind.
  await openRegistry(page);
  const registry = page.getByLabel("World feature registry");
  await page.getByLabel("Search registry").fill("Kibo");
  await expect(registry.locator("tbody tr")).toHaveCount(1);
  await expect(registry.locator("tbody tr").first()).toContainText("Volcanic mountain");
  await page.getByLabel("Search registry").fill("");
  await closeDrawer(page);

  await panel(page).getByRole("button", { name: "Remove landmark", exact: true }).last().click();
  await expect(panel(page).getByRole("button", { name: "Edit landmark", exact: true })).toHaveCount(
    1
  );
  await expect(panel(page)).not.toContainText("Long Cut");
  expect(errors).toEqual([]);
});

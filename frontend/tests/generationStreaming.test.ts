import { expect, test } from "./uiTest";
test.use({ generationLifecycle: "Verify preview, cancellation and progressive publication." });
import { installGenerationFixture, completeGenerationFixture } from "./generationFixture";
import { mapImage, openMapSettings } from "./harness";

test("an epoch preview shows while generation continues and clears on cancellation @rendering", async ({
  page,
}) => {
  await installGenerationFixture(page, { hold: true });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Growing atlas");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await page.waitForFunction(() => "generationFixtureSnapshot" in window);
  const blank = await mapImage(page);
  await page.evaluate(() => {
    const fixture = window as unknown as {
      generationFixtureSnapshot: import("@atlas/domain").DomainSnapshot;
      generationFixtureWorker: { onmessage: (event: MessageEvent) => void };
    };
    const grid = {
      id: "generation-preview",
      scope: fixture.generationFixtureSnapshot.scope,
      bounds: [0, 0, 4_000_000, 3_000_000],
      width: 2,
      height: 2,
      active: new Uint8Array(4).fill(1),
      measures: new Float64Array(4).fill(1),
      channels: { elevation: new Float64Array([-50, 30, 70, 150]) },
      units: { elevation: "metre" },
    };
    fixture.generationFixtureWorker.onmessage(
      new MessageEvent("message", { data: { kind: "preview", grid, label: "Formation" } })
    );
  });
  await expect(page.locator(".map-instruction")).toContainText("Generation preview · Formation");
  await expect(page.getByRole("application", { name: "World map canvas" })).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await expect(page.locator(".job-row strong").first()).toHaveText("running");
  await expect.poll(() => mapImage(page)).not.toBe(blank);
  await page.getByRole("button", { name: "Cancel generation" }).click();
  await expect(page.locator(".map-instruction")).not.toContainText("Generation preview");
});

test("arriving fields display before the completion notification @rendering", async ({ page }) => {
  await installGenerationFixture(page, { hold: true, numerical: true, terrain: true });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Arriving fields");
  await page.getByLabel("Width · km", { exact: true }).fill("1");
  await page.getByLabel("Height · km", { exact: true }).fill("1");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await page.waitForFunction(() => "generationFixtureSnapshot" in window);
  const blank = await mapImage(page);
  await page.evaluate(() => {
    const fixture = window as unknown as {
      generationFixtureWorker: { onmessage: (event: MessageEvent) => void };
      finishStream?: () => void;
    };
    const receive = fixture.generationFixtureWorker.onmessage;
    fixture.generationFixtureWorker.onmessage = (event) => {
      if (event.data.kind === "completed") fixture.finishStream = () => receive(event);
      else receive(event);
    };
  });
  await completeGenerationFixture(page);
  await expect(page.locator(".job-row strong").first()).toHaveText("running");
  await expect(page.locator(".map-status")).toContainText("Generation in progress");
  await expect.poll(() => mapImage(page)).not.toBe(blank);
  await openMapSettings(page);
  await expect(
    page.getByRole("button", { name: "Adjust terrain appearance", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("application", { name: "World map canvas" })).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await page.evaluate(() => (window as unknown as { finishStream(): void }).finishStream());
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
});

import { expect, test } from "@playwright/test";
import { installGenerationFixture, completeGenerationFixture } from "./generationFixture";

test("an epoch preview shows while generation continues and clears on cancellation", async ({
  page,
}) => {
  await installGenerationFixture(page, { hold: true });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Growing atlas");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
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
  await page.getByRole("button", { name: "Cancel generation" }).click();
  await expect(page.locator(".map-instruction")).not.toContainText("Generation preview");
});

test("arriving fields display before the completion notification", async ({ page }) => {
  await installGenerationFixture(page, { hold: true, fields: true, terrain: true });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Arriving fields");
  await page.getByLabel("Width · km", { exact: true }).fill("1");
  await page.getByLabel("Height · km", { exact: true }).fill("1");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
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
  await page.getByRole("button", { name: "Layers", exact: true }).click();
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

test("completes real Draft generation through the browser worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Scheduled Draft atlas");
  await page.getByLabel("Width · km", { exact: true }).fill("1000");
  await page.getByLabel("Height · km", { exact: true }).fill("750");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText(/completed|failed/, {
    timeout: 90000,
  });
  expect(await page.locator(".job-row .error").allTextContents()).toEqual([]);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await expect(page.getByRole("application", { name: "World map canvas" })).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await expect(page.locator(".map-instruction")).not.toContainText("Generation preview");
  expect(errors).toEqual([]);
});

test("delivers real Fine generation through transferable messages", async ({ page }) => {
  test.skip(!process.env.ATLAS_STREAMING_FINE, "Opt-in full Fine generation");
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const stats = { previews: 0, buffers: 0, bytes: 0, completedKeys: [] as string[] };
    Object.assign(window, { generationTransfers: stats });
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (String(args[0]).includes("generation.worker"))
          worker.addEventListener("message", ({ data }) => {
            if (data.kind === "preview") stats.previews++;
            if (data.kind === "samples") {
              const buffers = new Set<ArrayBuffer>(
                (data.samples as { value: ArrayBufferView<ArrayBuffer> }[]).map(
                  (sample) => sample.value.buffer
                )
              );
              stats.buffers += buffers.size;
              stats.bytes += [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
            }
            if (data.kind === "completed") stats.completedKeys = Object.keys(data);
          });
        return worker;
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Fine streamed atlas");
  await page.getByLabel("Detail level").selectOption("fine");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".map-instruction")).toContainText("Generation preview", {
    timeout: 300000,
  });
  await expect(page.locator(".job-row strong").first()).toHaveText(/completed|failed/, {
    timeout: 540000,
  });
  expect(await page.locator(".job-row .error").allTextContents()).toEqual([]);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const transfers = await page.evaluate(() => Reflect.get(window, "generationTransfers"));
  console.log("Fine worker delivery", transfers);
  expect(transfers.previews).toBeGreaterThan(1);
  expect(transfers.buffers).toBeGreaterThan(1);
  expect(transfers.completedKeys).toEqual(["kind"]);
  expect(errors).toEqual([]);
});

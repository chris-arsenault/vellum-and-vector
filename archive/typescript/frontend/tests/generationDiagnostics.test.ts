import { expect, test } from "./uiTest";
test.use({ generationLifecycle: "Verify diagnostics during generation and publication." });
import { completeGenerationFixture, installGenerationFixture } from "./generationFixture";

for (const failed of [false, true])
  test(`process diagnostics remain inspectable after ${failed ? "failure" : "publication"}`, async ({
    page,
  }) => {
    const diagnostics = Array.from({ length: 5 }, (_, i) => ({
      code: failed ? "process_failed" : "approximate",
      severity: failed ? ("error" as const) : ("warning" as const),
      message: `${failed ? "Failed" : "Approximate"} process ${i}`,
      invocation: `history/process-${i}`,
      resource: null,
      process: `process-${i}`,
      epochs: [{ id: "Ancient", duration: 1000, parentEpoch: null, variables: {} }],
      outcome: failed ? ("failed" as const) : ("retained" as const),
      stack: failed ? `Error: failure ${i}` : undefined,
    }));
    await installGenerationFixture(page, { hold: true, diagnostics });
    await page.goto("/");
    await page.getByLabel("World name", { exact: true }).fill("Partial geography");
    await page.getByLabel("Detail level").selectOption("draft");
    await page.getByRole("button", { name: /Review & generate/ }).click();
    await page.getByRole("button", { name: "Generate world", exact: true }).click();
    const job = page.locator(".job-row").first();
    await expect(job.locator("strong")).toHaveText("running");
    await job.getByText("Inspect diagnostics (5)", { exact: true }).click();
    await job.getByText(`${failed ? "Failed" : "Approximate"} process 4`, { exact: true }).click();
    await expect(job.locator("pre").last()).toBeVisible();
    await expect(job.locator("pre").last()).toContainText('"id": "Ancient"');
    await expect(job.locator("pre").last()).toContainText(
      `"outcome": "${failed ? "failed" : "retained"}"`
    );
    await completeGenerationFixture(page);
    await expect(job.locator("strong")).toHaveText(failed ? "failed" : "completed");
    await expect(job.getByText("Inspect diagnostics (5)", { exact: true })).toBeVisible();
    if (failed) await expect(job.locator("pre").last()).toContainText("Error: failure 4");
  });

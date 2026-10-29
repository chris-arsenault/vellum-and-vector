import { expect, test } from "./uiTest";
test.use({ generationLifecycle: "Verify diagnostics during generation and publication." });
import { completeGenerationFixture, installGenerationFixture } from "./generationFixture";

test("every process diagnostic stays inspectable during generation and after publication", async ({
  page,
}) => {
  const diagnostics = Array.from({ length: 5 }, (_, i) => ({
    code: "process_failed",
    severity: "error" as const,
    message: `Omitted process ${i}`,
    invocation: `history/process-${i}`,
    resource: null,
    process: `process-${i}`,
    epochs: [{ id: "Ancient", duration: 1000, parentEpoch: null, variables: {} }],
    outcome: "omitted" as const,
    stack: `Error: failure ${i}`,
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
  await job.getByText("Omitted process 4", { exact: true }).click();
  await expect(job.locator("pre").last()).toBeVisible();
  await expect(job.locator("pre").last()).toContainText('"id": "Ancient"');
  await expect(job.locator("pre").last()).toContainText('"outcome": "omitted"');
  await completeGenerationFixture(page);
  await expect(job.locator("strong")).toHaveText("completed");
  await expect(job.getByText("Inspect diagnostics (5)", { exact: true })).toBeVisible();
  await expect(job.locator("pre").last()).toContainText("Error: failure 4");
});

import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

it("fails immediately if a unit test reaches the Rust generator through a dynamic import", async () => {
  const generation = await import("@atlas/engine");
  expect(generation.initializeEngine).toThrow("Full generation is forbidden in unit tests");
});

it.each([
  ["src/example.test.ts", 'import { generateAtlas as run } from "@atlas/generation"; run();'],
  [
    "src/example.test.ts",
    'import { physicalSchedule } from "../../packages/generation/src/world/schedule"; physicalSchedule([]);',
  ],
  ["tests/example.test.ts", 'import { test } from "@playwright/test"; test("bad", () => {});'],
])("lint rejects an expensive test bypass in %s", async (filePath, code) => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
  const [result] = await eslint.lintText(code, { filePath });
  expect(result.messages.some((message) => message.ruleId === "no-restricted-imports")).toBe(true);
});

it.each([
  'test("navigation", () => setup({ fields: true }));',
  'test("navigation", () => generatedWorld(page, "Atlas"));',
])("rejects repeated generation or rendering-coupled setup: %s", async (code) => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
  const [result] = await eslint.lintText(code, {
    filePath: "tests/example.test.ts",
  });
  expect(result.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
});

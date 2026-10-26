import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ESLint } from "eslint";
import { expect, it } from "vitest";
import { constructedWorld } from "./constructedWorldFixture";

it("fails immediately if a unit test reaches the full generator through a dynamic import", async () => {
  const generation = await import("../../packages/generation/src/atlasWorkflow");
  const { source, input } = constructedWorld();
  expect(() => generation.generateAtlas(source, input)).toThrow(
    "Full generation is forbidden in unit tests"
  );
});

it("keeps one full generator call shared across all end-to-end checks and no scale suite", () => {
  const directory = fileURLToPath(new URL("./", import.meta.url));
  expect(
    readdirSync(directory, { recursive: true }).filter((name) =>
      /\.(generation|scale)\.test\.ts$/.test(String(name))
    )
  ).toEqual(["worldIntegration.generation.test.ts"]);
  const source = ts.createSourceFile(
    "integration.ts",
    readFileSync(`${directory}/worldIntegration.generation.test.ts`, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  let generators = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "generateAtlas") {
      generators++;
      let parent: ts.Node | undefined = node.parent;
      while (
        parent &&
        !(ts.isCallExpression(parent) && parent.expression.getText(source) === "beforeAll")
      )
        parent = parent.parent;
      expect(parent, "full generation must live in the shared beforeAll hook").toBeDefined();
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(generators).toBe(1);
});

it.each([
  ["src/example.test.ts", 'import { generateAtlas as run } from "@atlas/generation"; run();'],
  [
    "src/example.test.ts",
    'import { physicalSchedule } from "../../packages/generation/src/canonry/schedule"; physicalSchedule([]);',
  ],
  ["tests/example.test.ts", 'import { test } from "@playwright/test"; test("bad", () => {});'],
])("lint rejects an expensive test bypass in %s", async (filePath, code) => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
  const [result] = await eslint.lintText(code, { filePath });
  expect(result.messages.some((message) => message.ruleId === "no-restricted-imports")).toBe(true);
});

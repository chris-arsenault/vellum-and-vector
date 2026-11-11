import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Geology always runs. Every world has generated geography and a child map refines the
 * terrain it inherits, so no code may branch on whether the physical domain was requested or
 * on whether an earlier run included it. The single requirement lives in `geographyRequired`.
 */
const root = join(__dirname, "../../..");
const requirement = "packages/generation/src/geographyRequired.ts";
const forbidden: [RegExp, string][] = [
  [/includes\(\s*["']physical["']\s*\)/, "asks whether the physical domain is selected"],
  [/["']terrain:present["']/, "marks terrain as present without generating it"],
  [/preserveTerrain/, "preserves terrain for a run without geology"],
];

function* sources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* sources(path);
    } else if (/\.tsx?$/.test(entry.name) && !/\.architecture\.ts$/.test(entry.name)) yield path;
  }
}
function findings() {
  const directories = ["domain", "generation", "application", "storage-browser"].map((name) =>
    join(root, "packages", name, "src")
  );
  const found: string[] = [];
  for (const directory of [...directories, join(root, "frontend/src")])
    for (const path of sources(directory)) {
      const file = relative(root, path);
      if (file === requirement) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((text, index) => {
          for (const [pattern, reason] of forbidden)
            if (pattern.test(text)) found.push(`${file}:${index + 1} ${reason}`);
        });
    }
  return found;
}

it("no code path distinguishes a run without geology", () => {
  expect(findings()).toEqual([]);
}, 30_000);
it("states the requirement in exactly one place", () => {
  const text = readFileSync(join(root, requirement), "utf8");
  expect(text.match(/includes\(\s*["']physical["']\s*\)/g)).toHaveLength(1);
});

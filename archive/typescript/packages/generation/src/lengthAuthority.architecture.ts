import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { lengthAuthorityFindings } from "./lengthAuthorityCheck";

const root = join(__dirname, "../../..");
function* runtimeSources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !["harness", "testSupport", "fixtures"].includes(entry.name))
      yield* runtimeSources(path);
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|architecture)\.tsx?$|fixtures?\.tsx?$/i.test(entry.name)
    )
      yield path;
  }
}
it("runtime geographic dimensions use the shared MapScale authority", () => {
  const directories = ["domain", "generation", "application", "storage-browser"].map(
      (packageName) => join(root, "packages", packageName, "src")
    ),
    files = [...directories, join(root, "frontend/src")]
      .flatMap((directory) => [...runtimeSources(directory)])
      .filter((path) => !path.endsWith("/domain/src/mapScale.ts")),
    findings = lengthAuthorityFindings(
      files.map((path) => ({
        file: relative(root, path),
        text: readFileSync(path, "utf8"),
      }))
    );
  const format = ({ file, line, rule, detail }: (typeof findings)[number]) =>
    `${file}:${line} [${rule}] ${detail}`;
  const inventory = findings.filter((finding) => finding.certainty === "inventory");
  if (inventory.length)
    console.info(
      "Unclassified dimension candidates (names alone do not establish units):\n" +
        inventory.map(format).join("\n")
    );
  expect(findings.filter((finding) => finding.certainty === "boundary").map(format)).toEqual([]);
}, 30_000);

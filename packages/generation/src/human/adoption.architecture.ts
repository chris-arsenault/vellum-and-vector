import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * People live on the land's layers. The catchment records that once held them, with their
 * per-community ledgers and lists of links, are gone, and nothing may bring them back beside
 * the layers: no source file names their types, a generation state's `society` member, or the
 * community ids that records and ways carried.
 *
 * The check reads source text. It is not compiler-resolved: a reference through an alias that
 * names none of these is not seen.
 */
const root = join(__dirname, "../../../..");
const old =
  /\b(SocietyCommunity|SocietyRegion|SocietyConnection|SocietyWork|SocietyPolity|SocietyEvent|SocietySupport|HumanRound|SettlementHierarchy)\b|[.?!]society\b|\bsociety[!?]?\.region\b|communityId|fromCommunity|toCommunity/;

function* sources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "harness", "testSupport"].includes(entry.name)) yield* sources(path);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|architecture)\.tsx?$|Fixture/.test(entry.name)
    )
      yield path;
  }
}
function naming() {
  const directories = [
    ...["domain", "generation", "application", "storage-browser"].map((name) =>
      join(root, "packages", name, "src")
    ),
    join(root, "frontend/src"),
  ];
  return directories
    .flatMap((directory) => [...sources(directory)])
    .filter((path) => old.test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path))
    .sort();
}

it("names the old society records nowhere", () => {
  expect(naming()).toEqual([]);
});

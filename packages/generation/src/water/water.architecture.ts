import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { waterBandNames } from "@atlas/domain";
import { source, sourceFiles } from "../architectureReach";

/**
 * Water has one owner (docs/adr/0014-water-is-a-column-and-a-lasting-network.md). Everything
 * that makes, moves, stores or loses water lives in this namespace and writes water state
 * through it; everything else asks. These checks prove who writes; they say nothing about
 * what a map's water looks like.
 *
 * owner-direction(2026-11-12): water gets the same intentional paradigms and columnar state as geology and society.
 *
 * While the rewrite is in progress the first check fails, and its failure lists what is still
 * to be moved under the owner. A writer is taken off that list by replacing it, never by
 * exempting it here.
 */
const files = () => [...sourceFiles(source)].map((path) => relative(source, path));
const text = (path: string) => readFileSync(join(source, path), "utf8");
const bands = [...waterBandNames] as string[];
/** Lines of the files that match, as `file:line`. */
function lines(paths: string[], pattern: RegExp) {
  return paths.flatMap((path) =>
    text(path)
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}`] : []))
  );
}
const outside = () => files().filter((path) => !path.startsWith("water/"));

describe("water has one owner", () => {
  const writes = new RegExp(`\\b(${bands.join("|")})\\b\\s*\\)?\\s*\\.(set|add|fill|copyFrom)\\(`);
  it("writes water bands only inside the water namespace", () => {
    expect(lines(outside(), writes)).toEqual([]);
  });
  it("keeps no water state beside the map: no store keyed by map outside the owner's own", () => {
    // State held in a side store is not saved with a run and not inherited by a finer map.
    const inside = files().filter(
      (path) => path.startsWith("water/") && !/\.(test|architecture)\.ts$/.test(path)
    );
    expect(lines(inside, /new WeakMap</)).toEqual([]);
  });
});

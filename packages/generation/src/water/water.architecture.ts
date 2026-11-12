import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { waterBandNames } from "@atlas/domain";
import { source, sourceFiles } from "../architectureReach";
import { Contributions } from "../coupling/fieldContributions";
import type { MutablePhysicalBufferName } from "../world/field";

/**
 * Water has one owner (docs/adr/0014-water-is-a-column-and-a-lasting-network.md). Everything
 * that makes, moves, stores or loses water lives in this namespace and writes water state
 * through it; everything else asks. These checks prove who writes; they say nothing about
 * what a map's water looks like.
 *
 * owner-direction(2026-11-12): water gets the same intentional paradigms and columnar state as geology and society.
 *
 * A writer that appears outside the owner is brought under it or made to ask; it is never
 * exempted here. A place changes water by asking: the contributions ledger refuses a water
 * band outright.
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
/** Fixtures that set a map up for tests are tests' own, as test files are. */
const outside = () =>
  files().filter((path) => !path.startsWith("water/") && !/Fixtures?\.ts$/.test(path));

describe("water has one owner", () => {
  const writes = new RegExp(`\\b(${bands.join("|")})\\b\\s*\\)?\\s*\\.(set|add|fill|copyFrom)\\(`);
  it("writes water bands only inside the water namespace", () => {
    expect(lines(outside(), writes)).toEqual([]);
  });
  it("lets no place put a change on water through the contributions ledger", () => {
    const ledger = new Contributions(1);
    for (const band of waterBandNames)
      expect(() => ledger.add(band as MutablePhysicalBufferName, 0, 1), band).toThrow();
  });
  it("keeps no water state beside the map: no store keyed by map outside the owner's own", () => {
    // State held in a side store is not saved with a run and not inherited by a finer map.
    const inside = files().filter(
      (path) => path.startsWith("water/") && !/\.(test|architecture)\.ts$/.test(path)
    );
    expect(lines(inside, /new WeakMap</)).toEqual([]);
  });
});

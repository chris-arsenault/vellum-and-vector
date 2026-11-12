import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { source, sourceFiles } from "../architectureReach";

/**
 * A region keeps its parent's ground (docs/WATER-AND-RELIEF-PLAN.md). Its starting surface is
 * the parent's surface; detail is cut into it and raised on it. Heights are never rebuilt
 * from a formula, and nothing is fitted or pinned to the parent numerically. This check was
 * written failing, before the code met it, and is not loosened to pass.
 *
 * The owner's direction of 2026-11-12: a region starts at the parent's level and gets more
 * defined; the parent's elevation is not thrown away. (To be entered in the owner-directions
 * registry once that file is free of another session's open edits.)
 */
const regional = () =>
  [...sourceFiles(join(source, "regional"))].map((path) => relative(source, path));
function lines(pattern: RegExp) {
  return regional().flatMap((path) =>
    readFileSync(join(source, path), "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}`] : []))
  );
}

it("never builds a region's heights up from its drainage tree", () => {
  // A height set to the height downstream plus a rise, or a whole surface handed to the
  // ground to be matched, is a rebuilt surface.
  expect(lines(/\brealizeSurface\b|\brootHeight\b|=\s*from\s*\+\s*increment/)).toEqual([]);
});

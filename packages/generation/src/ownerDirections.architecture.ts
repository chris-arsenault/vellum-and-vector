import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Whose direction the code carries (AGENTS.md, "Whose direction the code carries").
 *
 * Agents design most of this application and may redesign what they designed. The owner's own
 * directions and corrections stand until the owner changes them. Each is marked in the code it
 * governs with `owner-direction(<date>): <direction>` and listed here. This check fails when a
 * listed mark is gone, so a direction cannot be removed without someone seeing this file.
 *
 * Do not edit an entry, its mark or its test on your own judgement: ask the owner. When the
 * owner gives a direction, add its mark, its entry and, where a test can state it, its test.
 */
interface OwnerDirection {
  /** The direction, in the owner's terms. */
  direction: string;
  given: string;
  /** Files, from the repository root, whose marked line carries the direction. */
  marks: readonly string[];
  /** The test that fails if the behaviour is undone, where one can state it. */
  test?: string;
}
const directions: readonly OwnerDirection[] = [
  {
    direction: "plate movement and tectonic strength cannot be coupled",
    given: "2026-11-07, restated 2026-11-12",
    marks: ["packages/generation/src/world/tectonicControls.ts"],
    test: "packages/generation/src/world/tectonicMotion.test.ts",
  },
  {
    direction: "plate travel needs to be much bigger; a few cells of travel is not enough",
    given: "2026-11-07",
    marks: ["packages/generation/src/terrainCartography.ts"],
    test: "frontend/src/cartographicDraft.test.ts",
  },
  {
    direction: "plate travel is a share of the world's size, not a fixed distance",
    given: "2026-11-07",
    marks: ["packages/generation/src/world/profile.ts"],
  },
  {
    direction: "the default world has mixed mountains and plains, not low-activity plains",
    given: "2026-11-12",
    marks: ["packages/generation/src/terrainCartography.ts"],
  },
  {
    direction: "the resolutions are fixed; a detail level is not a cell count",
    given: "2026-11-12",
    marks: ["packages/generation/src/resolution.ts", "packages/domain/src/regionalScale.ts"],
    test: "packages/generation/src/resolution.test.ts",
  },
];

const root = join(__dirname, "../../..");
const mark = ({ given, direction }: OwnerDirection) => `owner-direction(${given}): ${direction}`;
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the owner's directions are still carried by the code", () => {
  for (const entry of directions)
    it(entry.direction, () => {
      for (const path of entry.marks) expect(read(path), path).toContain(mark(entry));
      if (entry.test) expect(existsSync(join(root, entry.test)), entry.test).toBe(true);
    });
  it("lists every mark in the code", () => {
    const listed = new Set(directions.map(mark));
    const found = directions
      .flatMap((entry) => entry.marks)
      .flatMap((path) => [...read(path).matchAll(/owner-direction\([^)]*\): [^\n*]+/g)])
      .map((match) => match[0].trim().replace(/\.$/, ""));
    expect(found.filter((text) => !listed.has(text))).toEqual([]);
  });
});

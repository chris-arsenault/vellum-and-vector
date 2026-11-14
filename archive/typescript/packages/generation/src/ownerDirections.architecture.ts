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
  test?: string | readonly string[];
}
const directions: readonly OwnerDirection[] = [
  {
    direction: "computation uses one Rust core for native and WASM",
    given: "2026-11-12",
    marks: ["frontend/src/generation.worker.ts", "packages/server/src/nativeGeneration.ts"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "child elevation and coastline may change freely, including at their edges",
    given: "2026-10-29",
    marks: ["crates/atlas-generation/src/field/refinement/adaptive_relief.rs"],
  },
  {
    direction: "delete both old C# and TypeScript backends",
    given: "2026-11-12",
    marks: ["packages/atlas-context/src/separation.architecture.ts"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "later parent changes leave children's captured inputs unchanged",
    given: "2026-10-29",
    marks: ["packages/application/src/captureSelectedMap.ts"],
    test: "frontend/src/generationInputs.test.ts",
  },
  {
    direction: "software architecture paradigms should not change during the Rust port",
    given: "2026-11-12",
    marks: ["crates/atlas-generation/src/execution.rs"],
    test: "crates/atlas-generation/tests/execution.rs",
  },
  {
    direction: "map and generation use separate schemas",
    given: "2026-11-12",
    marks: [
      "crates/atlas-map/src/lib.rs",
      "packages/map/src/index.ts",
      "packages/storage-browser/src/mapSchema.ts",
      "packages/storage-postgres/src/map.sql",
    ],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "only pure browser or pure backend is supported",
    given: "2026-11-12",
    marks: ["packages/atlas-context/src/context.ts"],
    test: "packages/atlas-context/src/context.test.ts",
  },
  {
    direction:
      "water gets the same intentional paradigms and columnar state as geology and society",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/water/water.architecture.ts",
      "crates/atlas-generation/src/water/owner.rs",
    ],
    test: "packages/generation/src/water/water.architecture.ts",
  },
  {
    direction: "add the river-mouth sediment deposition process back",
    given: "2026-11-13",
    marks: [
      "packages/generation/src/world/fluvial.ts",
      "crates/atlas-generation/src/processes/fluvial.rs",
    ],
    test: [
      "packages/generation/src/world/riverMouthDeposition.test.ts",
      "crates/atlas-generation/src/field/sediment_tests.rs",
    ],
  },
  {
    direction:
      "rivers are kept things that processes change; cells hold quantities and are never rivers",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/water/reachEvolution.ts",
      "crates/atlas-generation/src/water/evolution.rs",
    ],
    test: "packages/generation/src/water/reachEvolution.test.ts",
  },
  {
    direction: "water gets an actual column of water, carried and inherited as one package",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/water/column.ts",
      "crates/atlas-generation/src/water/column.rs",
    ],
    test: "packages/generation/src/water/column.test.ts",
  },
  {
    direction: "a cell's own yield, however large, never makes it a river",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/water/riverSize.ts",
      "crates/atlas-generation/src/water/network.rs",
    ],
    test: "packages/generation/src/water/riverSize.test.ts",
  },
  {
    direction:
      "the stream a parent's river-side town stands on continues on a finer map whatever its water there",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/regional/seats.ts",
      "crates/atlas-generation/src/field/refinement/seats.rs",
    ],
    test: "packages/generation/src/regional/seats.test.ts",
  },
  {
    direction:
      "numerical accuracy and reproducibility are not goals of this repository, and guarding them is forbidden",
    given: "2026-11-13",
    marks: ["packages/generation/src/world/validation.ts"],
    test: "packages/generation/src/world/riverValidation.test.ts",
  },
  {
    direction:
      "a region starts at the parent's level and gets more defined; the parent's elevation is not thrown away",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/regional/startingGround.ts",
      "crates/atlas-generation/src/field/refinement/columns.rs",
    ],
    test: "packages/generation/src/rock/groundShares.test.ts",
  },
  {
    direction:
      "what is inside a parent cell comes from the rock column, shaped by all the relevant processes",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/rock/contactRealization.ts",
      "crates/atlas-generation/src/rock/ground/contacts.rs",
    ],
    test: "packages/generation/src/rock/contactRealization.test.ts",
  },
  {
    direction: "plate movement and tectonic strength cannot be coupled",
    given: "2026-11-07, restated 2026-11-12",
    marks: [
      "packages/generation/src/world/tectonicControls.ts",
      "crates/atlas-generation/src/tectonics/controls.rs",
    ],
    test: [
      "packages/generation/src/world/tectonicMotion.test.ts",
      "crates/atlas-generation/tests/tectonics.rs",
    ],
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
    marks: [
      "packages/generation/src/world/profile.ts",
      "crates/atlas-generation/src/tectonics/province_settings.rs",
    ],
    test: "crates/atlas-generation/tests/tectonics.rs",
  },
  {
    direction:
      "the default is a good mix of very mountainous parts and large stretches of relatively flat land",
    given: "2026-11-09, restated 2026-11-12",
    marks: ["packages/generation/src/terrainCartography.ts"],
  },
  {
    // Magic and terrain settings are entered as shares of the map; cell size is not.
    direction: "geology is shares of the map; digital representation precision is fixed",
    given: "2026-11-12",
    marks: ["packages/domain/src/mapScale.ts", "crates/atlas-generation/src/scale.rs"],
  },
  {
    direction:
      "a standard region has roughly the cells of the default standard world, at 7-ish land regions in a world",
    given: "2026-11-12",
    marks: ["packages/domain/src/regionalScale.ts"],
    test: "packages/domain/src/regionalScale.test.ts",
  },
  {
    // Covers world detail levels and the regional ladder (confirmed 2026-11-12).
    direction: "the resolutions are fixed; a detail level is not a cell count",
    given: "2026-11-12",
    marks: [
      "packages/generation/src/resolution.ts",
      "packages/domain/src/regionalScale.ts",
      "crates/atlas-generation/src/atlas/resolution.rs",
    ],
    test: ["packages/generation/src/resolution.test.ts", "crates/atlas-generation/tests/scale_settings.rs"],
  },
];

const root = join(__dirname, "../../..");
const mark = ({ given, direction }: OwnerDirection) => `owner-direction(${given}): ${direction}`;
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the owner's directions are still carried by the code", () => {
  for (const entry of directions)
    it(entry.direction, () => {
      for (const path of entry.marks) expect(read(path), path).toContain(mark(entry));
      const tests = typeof entry.test === "string" ? [entry.test] : (entry.test ?? []);
      for (const path of tests) expect(existsSync(join(root, path)), path).toBe(true);
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

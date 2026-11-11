import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { humanBandNames } from "@atlas/domain";
import { source, sourceFiles } from "../architectureReach";
import { quantityKinds } from "../coupling/quantities";
import { physicalChannels } from "../world/atlasChannels";

/**
 * Structure of the people's layers on the land (docs/SOCIETY-ECONOMY-INTERACTIONS-PLAN.md).
 * These prove who may write the layers and what the new namespace may touch; they say nothing
 * about what a generated map looks like. The compiler carries the main guarantee: everyone
 * but the registered operations receives a read-only view of the owner. The source checks
 * here catch the direct routes round it; a band reached through an alias is not caught.
 */
const files = () => [...sourceFiles(source)].map((path) => relative(source, path));
const text = (path: string) => readFileSync(join(source, path), "utf8");
const bands = [...humanBandNames] as string[];
/** The owner: the band store, the changes, and how layers are lost and carried. */
const owner = ["layerBands", "humanLayers", "humanLoss", "humanCarry"].map(
    (name) => `human/${name}.ts`
  ),
  operations = "human/layerOperations.ts";
const namespace = () => files().filter((path) => path.startsWith("human/"));
/** Lines of the files that match, as `file:line`. */
function lines(paths: string[], pattern: RegExp) {
  return paths.flatMap((path) =>
    text(path)
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}`] : []))
  );
}

describe("docs/SOCIETY-ECONOMY-INTERACTIONS-PLAN.md is in progress", () => {
  it("fails until the old society structure is deleted (milestone M5 of that plan)", () => {
    // Remove this test at the end of M5, when the adoption inventory is empty.
    expect("old society structure").toBe("deleted");
  });
});

describe("people's layers have one writer", () => {
  const writes = new RegExp(`\\b(${bands.join("|")})\\b\\s*\\)?\\s*\\.(set|add|fill|copyFrom)\\(`);
  const namedWrites =
    /\[(humanLayers|humanRemains|identityColumn)\b[^\n]*\]\s*\.(set|add|fill|copyFrom)\(/;
  it("writes the layer bands only inside the owner", () => {
    const others = files().filter((path) => !owner.includes(path));
    expect([...lines(others, writes), ...lines(others, namedWrites)]).toEqual([]);
  });
  it("hands the owner's changes only to the registered operations", () => {
    const others = files().filter((path) => path !== operations && !owner.includes(path));
    expect(
      lines(others, /humanLayerWriter|HumanLayerWriter|\/(layerBands|humanLoss|humanCarry)"/)
    ).toEqual([]);
  });
  it("registers one opaque operation for each change the owner offers", () => {
    const offered = [
        ...text("human/humanLayers.ts")
          .split("class HumanLayers")[1]
          .matchAll(/^ {2}(?!private|constructor)(\w+)\(/gm),
      ].map((match) => match[1]),
      registered = [...text(operations).matchAll(/humanLayerWriter\(map\)\s*\.(\w+)\(/g)].map(
        (match) => match[1]
      );
    expect(offered.length).toBeGreaterThan(0);
    expect(registered.sort()).toEqual(offered.sort());
    expect(text(operations).match(/defineCommand\(/g)).toHaveLength(offered.length);
  });
});

describe("every human band is declared", () => {
  it("is carried by its owner as a package, never band by band", () => {
    expect(bands.filter((name) => quantityKinds[name] !== "carried")).toEqual([]);
  });
  it("has a unit and a publication owner, so maps and child maps receive it", () => {
    const declared = new Set<string>(physicalChannels.map(({ name }) => name));
    expect(bands.filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe("queries and the lattice", () => {
  it("keeps questions pure: a module that answers one submits no operation", () => {
    const answering = namespace().filter((path) => /\brespond\(\{/.test(text(path)));
    expect(answering.length).toBeGreaterThan(0);
    expect(lines(answering, /layerOperations|humanLayerWriter|runOperation|defineCommand/)).toEqual(
      []
    );
  });
  it("works on the land's mesh and never on the display raster", () => {
    expect(
      lines(
        namespace(),
        /\.surface\b|[{,]\s*surface\s*[,}:]|putChannel|gridPosition|gridNeighbors|RegularGrid/
      )
    ).toEqual([]);
  });
});

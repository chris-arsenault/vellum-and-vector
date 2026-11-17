import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artFor, type BuildingArtManifest } from "./buildingArt";
import { buildingUses, labelOfUse } from "./realScaleTown";

const folder = join(__dirname, "../public/building-art");

describe("shipped building art", () => {
  it("names only files that are shipped, so a use without art asks for nothing", () => {
    const manifest = JSON.parse(
      readFileSync(join(folder, "manifest.json"), "utf8")
    ) as BuildingArtManifest;
    for (const [use, file] of Object.entries(manifest.art))
      expect(existsSync(join(folder, file)), `${use}: ${file}`).toBe(true);
    for (const [use] of buildingUses)
      if (!manifest.art[use]) expect(artFor(manifest, use)).toBeNull();
  });
  it("finds a use's file beside the manifest and nothing for a use it does not name", () => {
    const manifest = { art: { inn: "inn.webp", hall: "../outside.webp" } };
    expect(artFor(manifest, "inn")).toMatch(/building-art\/inn\.webp$/);
    expect(artFor(manifest, "smithy")).toBeNull();
    expect(artFor(manifest, "hall")).toBeNull();
    expect(artFor(undefined, "inn")).toBeNull();
  });
  it("names every use in plain words", () => {
    expect(labelOfUse("marketHall")).toBe("Market hall");
    expect(labelOfUse("granary")).toBe("granary");
    expect(new Set(buildingUses.map(([id]) => id)).size).toBe(buildingUses.length);
  });
});

import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";

/**
 * Real Draft geography, generated in this process on the smallest world that yields rivers,
 * landforms and magic sites: the published features are what the registry, the inspector and
 * the GIS export read, so they carry stable ids, located magic sites with footprints, and point
 * waterfalls.
 */
it("publishes located sites, footprints and named features from real Draft geography", async () => {
  const world = createWorld({
    name: "Geographic atlas",
    seed: 104729,
    width: 500_000,
    height: 500_000,
  });
  const source = structuredClone(session(world.id).snapshot);
  const input = {
    areaId: Object.keys(world.areas)[0],
    seed: world.seed,
    quality: "draft",
    domains: ["physical", "magic", "cultural", "political", "built"],
  };
  const result = await generateAtlas(source, input, {});
  const published = generationSnapshot(result, input, crypto.randomUUID());
  const features = Object.values(published.world.features);
  expect(features.length).toBeGreaterThan(0);
  expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
  expect(features.every((f) => f.name.trim().length > 0)).toBe(true);
  const sites = new Set(["core", "spring", "vent", "well", "locus", "rogue", "breach"]);
  const located = features.filter(
    (f) => f.layerId === "magic" && sites.has(String(f.attributes.rule))
  );
  expect(located.length).toBeGreaterThan(0);
  for (const feature of located) {
    expect(feature.geometry.type).toBe("Point");
    expect(feature.footprint).toBeTruthy();
  }
  for (const feature of features.filter((f) => f.kind === "waterfall"))
    expect(feature.geometry.type).toBe("Point");
  expect(features.some((f) => f.kind === "settlement")).toBe(true);
}, 120_000);

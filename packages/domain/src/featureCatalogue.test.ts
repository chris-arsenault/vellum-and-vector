import { expect, it } from "vitest";
import { createWorldBlueprint } from "./worldCreation";
import { describeFeature, availableFeatureTypes, typePresentation } from "./featureCatalogue";
import { canonryMagicPresets } from "./magicPresets";
import { canonryConfluencePresets } from "./magicConfluences";
import { readAtlasFeatures } from "./featureReads";
import { composeFootprint } from "./composition";
import { rectangle, spatial } from "./spatial";
import type { AtlasFeature, World } from "./model";

function fixture() {
  const b = createWorldBlueprint({
    id: crypto.randomUUID(),
    name: "Catalogue",
    seed: 1,
    reference: {
      id: "planar",
      domain: rectangle([0, 0, 1000, 1000]),
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "sea",
      version: 1,
      precision: 1e-6,
    },
  });
  const world: World = {
    id: b.id,
    name: b.name,
    seed: b.seed,
    version: 1,
    owner: "user",
    reference: b.reference,
    areas: { [b.root.id]: b.root },
    layers: Object.fromEntries(b.layers.map((l) => [l.id, l])),
    features: {},
    fields: [],
    entities: {},
    templates: {},
    magic: [],
    landmarks: [],
    epochs: [],
    generations: [],
    views: [],
  };
  return world;
}
function feature(world: World, kind: string, layerId: string, attributes = {}): AtlasFeature {
  return {
    id: crypto.randomUUID(),
    name: kind,
    kind,
    layerId,
    areaId: Object.keys(world.areas)[0],
    geometry: { type: "Point", coordinates: [100, 100] },
    detail: {},
    attributes,
    relations: [],
    causes: [],
    actor: "user",
    state: "authored",
    protected: true,
    generationId: null,
  };
}
it("distinguishes every preset magic rule and preserves custom system identities", () => {
  const world = fixture();
  const types = availableFeatureTypes(world, [], true).filter((t) => t.layerId === "magic");
  // Every preset rule of every system plus every preset meeting between them.
  const expected =
    canonryMagicPresets().reduce((sum, system) => sum + system.features.length, 0) +
    canonryConfluencePresets().length;
  expect(types).toHaveLength(expected);
  expect(new Set(types.map((t) => t.id)).size).toBe(expected);
  const custom = describeFeature(
    world,
    feature(world, "rain:spring", "magic", { system: "rain", rule: "spring" })
  );
  expect(types.some((t) => t.id === custom.id)).toBe(false);
});
it("resolves biome and settlement subtypes, unknown custom types and independent type visibility", () => {
  const world = fixture();
  const a = describeFeature(world, feature(world, "forest", "ecology", { biome: "Mixed forest" }));
  const b = describeFeature(world, feature(world, "forest", "ecology", { biome: "Dry forest" }));
  const style = {
    layerId: "ecology",
    visible: true,
    opacity: 1,
    color: "#ffffff",
    minScale: 0,
    types: { [a.id]: { visible: false } },
  };
  expect(typePresentation(a, style).visible).toBe(false);
  expect(typePresentation(b, style).visible).toBe(true);
  expect(describeFeature(world, feature(world, "comet-sighting", "sightings")).path).toContain(
    "comet-sighting"
  );
  expect(
    describeFeature(
      world,
      feature(world, "settlement", "settlements", { settlementRole: "capital" })
    ).label
  ).toBe("Capitals");
});
it("reads a site's intersecting footprint once and composes it independently from its point", () => {
  const world = fixture(),
    f = feature(world, "fire:spring", "magic", { system: "fire", rule: "spring" });
  f.footprint = rectangle([50, 50, 300, 300]);
  world.features[f.id] = f;
  expect(
    readAtlasFeatures(world, f.areaId, rectangle([200, 200, 250, 250])).map((x) => x.id)
  ).toEqual([f.id]);
  expect(composeFootprint(world, f)?.type).toBe("Polygon");
  expect(readAtlasFeatures(world)[0].geometry.type).toBe("Point");
  f.geometry = { type: "Point", coordinates: [700, 700] };
  expect(
    readAtlasFeatures(world, f.areaId, rectangle([650, 650, 750, 750])).map((x) => x.id)
  ).toEqual([f.id]);
  expect(
    readAtlasFeatures(world, f.areaId, rectangle([200, 200, 250, 250])).map((x) => x.id)
  ).toEqual([f.id]);
});
it("shows a footprint added in a finer representation only at its supported profile", () => {
  const world = fixture(),
    f = feature(world, "poi", "pois"),
    root = world.areas[f.areaId];
  world.areas.child = {
    ...root,
    id: "child",
    parentId: root.id,
    profile: "region",
    footprint: rectangle([50, 50, 300, 300]),
  };
  f.detail.child = {
    geometry: f.geometry,
    footprint: rectangle([80, 80, 160, 160]),
    attributes: {},
    state: "authored",
    actor: "user",
    protected: true,
    generationId: null,
    needsReconciliation: false,
  };
  expect(composeFootprint(world, f, "world")).toBeNull();
  expect(composeFootprint(world, f, "region")).toEqual(
    spatial.canonical(f.detail.child.footprint!)
  );
});

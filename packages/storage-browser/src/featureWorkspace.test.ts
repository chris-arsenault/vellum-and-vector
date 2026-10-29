import { expect, it } from "vitest";
import { rectangle, restoreMappedEdits, spatial, type Diagnostic } from "@atlas/domain";
import { mappedBaseline } from "../../domain/src/mapEligibility";
import { landscape, configuration, invoke, options } from "../../generation/src/mapFixtures";
import {
  generatedFeature,
  putGenerated,
  prepareGeneratedProcess,
} from "../../generation/src/mapFeatures";
import { initializeFeatureWorkspace } from "../../generation/src/generationFeatures";
import { validateWorkingMap } from "../../generation/src/mapValidation";
import { publishGenerationProducts } from "../../generation/src/publication";
import { MapRunner } from "../../generation/src/mapRunner";
import { MapProcessRegistry } from "../../generation/src/process";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { retainGeographicIdentities } from "../../generation/src/canonry/geographicIdentity";
import { fixture, scope } from "./catalogFixture";

async function working() {
  let features!: SqliteFeatureWorkspace;
  let sourceFeatures!: SqliteFeatureWorkspace;
  await fixture((db) => {
    features = new SqliteFeatureWorkspace(db);
    sourceFeatures = new SqliteFeatureWorkspace(db, "source_features");
  });
  const state = landscape();
  state.domain.world.id = state.domain.scope.worldId = state.surface.scope.worldId = scope.worldId;
  const layer = {
    ...state.domain.world.layers.physical,
    id: "ecology",
    representation: "vector" as const,
    generator: "physical",
  };
  state.domain.world.layers.ecology = layer;
  state.publications = [{ kind: "geography", layer, featureKinds: ["forest"] }];
  state.surface.channels = {};
  state.surface.units = {};
  return { state, features, sourceFeatures };
}
it("retains exact working values and requires an explicit write for detached changes", async () => {
  const { state, features } = await working();
  const feature = generatedFeature(
    state,
    "forest",
    "Forest",
    "forest",
    "ecology",
    rectangle([10.0000001, 20, 100, 200])
  );
  feature.attributes = {
    missing: NaN,
    infinite: Infinity,
    values: new Float64Array([1, NaN]),
    counts: new Map([["x", 3]]),
  };
  features.put(feature);
  const read = features.get(feature.id)!;
  expect(read).toEqual(feature);
  read.name = "Changed";
  expect(features.get(feature.id)!.name).toBe(feature.name);
  const before = [...features.revisions()][0][1];
  features.put(read);
  expect(features.get(feature.id)!.name).toBe("Changed");
  expect([...features.revisions()][0][1]).toBeGreaterThan(before);
});
it("pages identities while reading updated records and skipping deleted records", async () => {
  const { state, features } = await working();
  for (let i = 0; i < 150; i++) {
    const feature = generatedFeature(
      state,
      `${i}`,
      `Forest ${i}`,
      "forest",
      "ecology",
      rectangle([10, 20, 100, 200])
    );
    feature.id = String(i);
    if (i % 2) feature.areaId = "child";
    features.put(feature);
  }
  const records = features.values({ areaId: state.domain.scope.areaId });
  expect(records.next().value?.id).toBe("0");
  const changed = features.get("2")!;
  changed.name = "Changed after page selection";
  features.put(changed);
  features.remove("4");
  const remaining = [...records];
  expect(remaining[0].name).toBe(changed.name);
  expect(remaining).toHaveLength(73);
  expect(remaining.some((feature) => feature.id === "4")).toBe(false);
  expect(remaining.at(-1)?.id).toBe("148");
});
it("runs preparation against stored records and retains authored and referenced geography", async () => {
  const { state, features, sourceFeatures } = await working();
  const create = (id: string) =>
    generatedFeature(state, id, id, "forest", "ecology", rectangle([10, 20, 100, 200]));
  const authored = { ...create("authored"), state: "authored" as const };
  const referenced = create("referenced"),
    replaced = create("replaced");
  authored.relations = [{ kind: "follows", targetId: referenced.id }];
  for (const feature of [authored, referenced, replaced]) sourceFeatures.put(feature);
  const process = prepareGeneratedProcess(["physical"]);
  const result = await new MapRunner(
    configuration([invoke(process)]),
    new MapProcessRegistry().register(process)
  ).run(state, { ...options, features, sourceFeatures });
  expect(result.state.domain.world.features).toEqual({});
  expect(features.get(authored.id)).toEqual(authored);
  expect(features.get(referenced.id)).toEqual(referenced);
  expect(features.get(replaced.id)).toBeUndefined();
  expect(sourceFeatures.get(replaced.id)).toEqual(replaced);
  expect(state.domain.world.features).toEqual({});
});
it("checks authored protection and scope against stored values", async () => {
  const { state, features, sourceFeatures } = await working();
  const feature = {
    ...generatedFeature(
      state,
      "protected",
      "Forest",
      "forest",
      "ecology",
      rectangle([10, 20, 100, 200])
    ),
    protected: true,
  };
  state.domain.world.features[feature.id] = feature;
  const original = structuredClone(state.domain);
  sourceFeatures.put(feature);
  original.world.features = {};
  state.sourceFeatures = sourceFeatures;
  initializeFeatureWorkspace(state, features);
  expect(() => validateWorkingMap(state, original)).not.toThrow();
  const changed = features.get(feature.id)!;
  changed.name = "Forbidden";
  features.put(changed);
  expect(() => validateWorkingMap(state, original)).toThrow("authored feature");
  features.put(feature);
  const outside = generatedFeature(
    state,
    "outside",
    "Outside",
    "forest",
    "ecology",
    rectangle([5000, 0, 6000, 100])
  );
  putGenerated(state, outside);
  expect(() => validateWorkingMap(state, original)).not.toThrow();
  expect(features.get(outside.id)?.geometry).toEqual(outside.geometry);
  features.put({ ...outside, areaId: "another-map" });
  expect(() => validateWorkingMap(state, original)).toThrow("owned by the active map");
});
it("prepares separate child geometry clipped to a slanted regional extent", async () => {
  const { state, features, sourceFeatures } = await working();
  const parent = { ...structuredClone(state.domain.world.areas.area), id: "parent-map" };
  const footprint = {
    type: "Polygon" as const,
    coordinates: [
      [
        [0, 0],
        [1000, 0],
        [0, 700],
        [0, 0],
      ],
    ],
  };
  state.domain.world.areas[parent.id] = parent;
  state.domain.world.areas.area = {
    ...state.domain.world.areas.area,
    parentId: parent.id,
    profile: "region",
    map: { sourceAreaId: parent.id, sourceRevision: 1 },
  };
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface.scope.footprint = footprint;
  const clipped = spatial.intersection(rectangle([123.456789, 0, 400, 700]), footprint)!;
  sourceFeatures.put(
    generatedFeature(state, "coastal", "Coastal forest", "forest", "ecology", clipped)
  );
  const process = prepareGeneratedProcess(["physical"]);
  const result = await new MapRunner(
    configuration([invoke(process)]),
    new MapProcessRegistry().register(process)
  ).run(state, { ...options, features, sourceFeatures });
  expect(result.state.domain.world.areas[parent.id]).toEqual(parent);
  expect([...features.values()]).toEqual([]);
  expect([...sourceFeatures.values()]).toHaveLength(1);
});
it("repairs stored generated attributes at publication and retains its diagnostics", async () => {
  const { state, features } = await working();
  initializeFeatureWorkspace(state, features);
  const feature = generatedFeature(
    state,
    "forest",
    "Forest",
    "forest",
    "ecology",
    rectangle([10, 20, 100, 200]),
    { missing: NaN, values: new Float64Array([1, 2]) }
  );
  putGenerated(state, feature);
  const warnings: Diagnostic[] = [];
  expect(publishGenerationProducts(state, "run", undefined, warnings)).toEqual(
    new Set(["ecology"])
  );
  expect(features.get(feature.id)!.attributes).toMatchObject({ missing: null, values: [1, 2] });
  expect(warnings).toMatchObject([{ code: "repaired_attributes", resource: feature.id }]);
  expect(state.domain.world.features).toEqual({});
});
it("restores cosmetic map edits over fresh stored geography without retaining old geometry", async () => {
  const { state, features, sourceFeatures } = await working();
  const feature = generatedFeature(
    state,
    "forest",
    "Named forest",
    "forest",
    "ecology",
    rectangle([10, 20, 100, 200])
  );
  state.domain.world.features[feature.id] = feature;
  const baseline = mappedBaseline(state.domain.world, feature, feature.areaId);
  feature.detail[feature.areaId] = {
    geometry: baseline.mapBaseline!.geometry,
    attributes: { ...feature.attributes, nameMeaning: "Creator's name" },
    state: "generated",
    protected: false,
    needsReconciliation: false,
    actor: "creator",
    generationId: null,
    mapOnly: true,
    ...baseline,
  };
  const original = structuredClone(state.domain);
  sourceFeatures.put(feature);
  original.world.features = {};
  const fresh = { ...feature, detail: {}, geometry: rectangle([15, 20, 150, 250]) };
  state.domain.world.features = { [fresh.id]: fresh };
  initializeFeatureWorkspace(state, features);
  restoreMappedEdits(state.domain, original, { features, sourceFeatures });
  const restored = features.get(feature.id)!;
  expect(restored.geometry).toEqual(fresh.geometry);
  expect(spatial.difference(restored.detail[feature.areaId].geometry!, fresh.geometry)).toBeNull();
  expect(spatial.difference(fresh.geometry, restored.detail[feature.areaId].geometry!)).toBeNull();
  expect(restored.detail[feature.areaId].attributes?.nameMeaning).toBe("Creator's name");
  expect(state.domain.world.features).toEqual({});
});
it("reuses stored source identities and names while replacing their generated contour", async () => {
  const { state, features, sourceFeatures } = await working();
  const original = structuredClone(state.domain);
  const before = generatedFeature(
    state,
    "old",
    "Creator's woodland",
    "forest",
    "ecology",
    rectangle([10, 20, 100, 200]),
    { sourceAlgorithm: "atlas-ecology-1" }
  );
  sourceFeatures.put(before);
  state.sourceFeatures = sourceFeatures;
  initializeFeatureWorkspace(state, features);
  const after = generatedFeature(
    state,
    "new",
    "New contour",
    "forest",
    "ecology",
    rectangle([11, 20, 101, 200]),
    { sourceAlgorithm: "atlas-ecology-1" }
  );
  features.put(after);
  retainGeographicIdentities(state, original, 50, new Set([after.id]));
  expect(features.get(after.id)).toBeUndefined();
  expect(features.get(before.id)).toMatchObject({ name: before.name, geometry: after.geometry });
  expect(sourceFeatures.get(before.id)).toEqual(before);
  expect(state.domain.world.features).toEqual({});
});

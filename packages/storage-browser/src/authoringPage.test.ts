import { expect, it } from "vitest";
import { builtinLayers, rectangle, spatial, type AuthoringFeatureQuery } from "@atlas/domain";
import { generationSource } from "../../../frontend/src/workspaceGeneration";
import { loadGenerationFeatures } from "../../../frontend/src/generationInputs";
import { publishWorkspaceGeneration } from "../../../frontend/src/generationPublication";
import { ZarrResources } from "./zarrResources";
import { fixture, record, scope, write } from "./catalogFixture";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { SqliteNetworkWorkspace } from "./networkWorkspace";

async function sourceFixture() {
  let features!: SqliteFeatureWorkspace;
  let networks!: SqliteNetworkWorkspace;
  const catalog = await fixture((db) => {
    features = new SqliteFeatureWorkspace(db);
    networks = new SqliteNetworkWorkspace(db);
  });
  const records = Array.from({ length: 130 }, (_, i) =>
    record(`feature-${String(i).padStart(3, "0")}`)
  );
  await write(catalog, [
    ...records,
    {
      scope,
      reference: { kind: "layer", id: "ecology", revision: 0 },
      data: { kind: "layer", value: builtinLayers().find((layer) => layer.id === "ecology")! },
    },
  ]);
  return { catalog, features, networks };
}
it("pages complete canonical inputs and linked geography without decoding the other pages", async () => {
  const { catalog, features } = await sourceFixture();
  const follower = record("follower");
  if (follower.data.kind !== "feature") throw new Error("Expected a feature");
  follower.data.value.relations = [{ kind: "follows", targetId: "outside" }];
  const outside = record("outside", rectangle([1200, 0, 1500, 100]));
  const unlinked = record("unlinked", rectangle([2000, 0, 2500, 100]));
  await write(catalog, [follower, outside, unlinked]);
  const source = await generationSource(catalog, scope.worldId, scope.areaId);
  expect(source.world.features).toEqual({});
  const partial = await catalog.readAuthoringPage(
    { scope: source.scope, featureIds: ["follower"], layers: [], dependencies: true },
    null,
    64
  );
  expect(Object.keys(partial.snapshot.world.features).sort()).toEqual(["follower", "outside"]);
  const sizes: number[] = [];
  await loadGenerationFeatures(
    source,
    {
      async readAuthoringPage(input, after, limit) {
        const page = await catalog.readAuthoringPage(input, after, limit);
        sizes.push(Object.keys(page.snapshot.world.features).length);
        return page;
      },
    },
    features
  );
  expect(sizes).toEqual([64, 64, 5]);
  expect([...features.values()]).toHaveLength(133);
  const unlinkedGeometry = features.get("unlinked")!.geometry;
  expect(spatial.bounds(unlinkedGeometry)).toEqual([2000, 0, 2500, 100]);
  expect(spatial.area(unlinkedGeometry)).toBe(50_000);
  expect(features.get("outside")!.geometry).toBeDefined();
  expect(features.get("follower")!.relations).toEqual([{ kind: "follows", targetId: "outside" }]);
  expect(source.world.features).toEqual({});
  expect(new Set(source.revisions.map((r) => `${r.kind}:${r.id}`)).size).toBe(
    source.revisions.length
  );
});
it("rejects a changed catalog revision between pages", async () => {
  const { catalog } = await sourceFixture();
  const source = await generationSource(catalog, scope.worldId, scope.areaId);
  const input: AuthoringFeatureQuery = {
    scope: source.scope,
    featureIds: [],
    layers: ["ecology"],
    dependencies: true,
  };
  const first = await catalog.readAuthoringPage(input, null, 64);
  await write(catalog, [record("added-later")]);
  await expect(catalog.readAuthoringPage(input, first.next, 64)).rejects.toThrow("world changed");
});
it("loads an existing unconnected node and its revision before a regional network reuses its identity", async () => {
  const { catalog, features, networks } = await sourceFixture(),
    node = {
      id: "old-junction",
      kind: "network:rivers",
      spaceId: scope.spaceId,
      position: { x: 50, y: 50, z: 100 },
      waterLevel: null,
    };
  await write(catalog, [
    {
      scope,
      reference: { kind: "node", id: node.id, revision: 0 },
      data: { kind: "node", value: node },
    },
  ]);
  const source = await generationSource(catalog, scope.worldId, scope.areaId);
  await loadGenerationFeatures(source, catalog, features, undefined, networks);
  expect(networks.node(node.id)).toEqual(node);
  expect(source.revisions.find((r) => r.kind === "node" && r.id === node.id)?.version).toBe(
    source.world.version
  );
  let developed!: SqliteNetworkWorkspace;
  await fixture((db) => {
    developed = new SqliteNetworkWorkspace(db);
  });
  developed.putNode({ ...node, position: { ...node.position, z: 200 } });
  const unused = () => {
    throw new Error("Node publication must not load fields");
  };
  await publishWorkspaceGeneration(
    catalog,
    new ZarrResources({ get: unused, set: unused, deletePrefix: unused, snapshot: unused }),
    source,
    structuredClone(source),
    crypto.randomUUID(),
    false,
    [],
    () => {},
    undefined,
    { features, sourceFeatures: features, networks: developed, sourceNetworks: networks }
  );
  const [updated] = await catalog.readRecords(scope, "node", [node.id]);
  expect(updated.data.kind === "node" && updated.data.value.position.z).toBe(200);
});
it("loads a child's outlying geometry without following links into parent geography", async () => {
  const { catalog, features } = await sourceFixture(),
    root = (await catalog.readRecords(scope, "area", [scope.areaId]))[0];
  if (root.data.kind !== "area") throw new Error("Expected an area");
  const childScope = { ...scope, areaId: "child" },
    child = record("child-forest", rectangle([2000, 0, 2500, 100]));
  if (child.data.kind !== "feature") throw new Error("Expected a feature");
  child.scope = childScope;
  child.data.value.areaId = "child";
  child.data.value.relations = [{ kind: "dependsOn", targetId: "feature-000" }];
  await write(catalog, [
    {
      scope: childScope,
      reference: { kind: "area", id: "child", revision: 0 },
      data: {
        kind: "area",
        value: {
          ...root.data.value,
          id: "child",
          parentId: scope.areaId,
          profile: "region",
          footprint: rectangle([20, 20, 80, 80]),
          map: { sourceAreaId: scope.areaId, sourceRevision: 1 },
        },
      },
    },
    child,
  ]);
  const source = await generationSource(catalog, scope.worldId, "child");
  await loadGenerationFeatures(source, catalog, features);
  expect([...features.values()].map((feature) => feature.id)).toEqual(["child-forest"]);
  const loaded = features.get("child-forest")!;
  expect(loaded).toMatchObject({ areaId: "child", relations: child.data.value.relations });
  expect(spatial.difference(loaded.geometry, child.data.value.geometry)).toBeNull();
  expect(spatial.difference(child.data.value.geometry, loaded.geometry)).toBeNull();
});
it("loads connected reaches outside the source window directly into the graph store", async () => {
  const { catalog, features, networks } = await sourceFixture();
  const rivers = [
    record("river-a", {
      type: "LineString",
      coordinates: [
        [0, 50],
        [500, 50],
      ],
    }),
    record("river-b", {
      type: "LineString",
      coordinates: [
        [500, 50],
        [1500, 50],
      ],
    }),
  ];
  for (const river of rivers)
    if (river.data.kind === "feature") {
      river.data.value.kind = "river";
      river.data.value.layerId = "rivers";
    }
  await write(catalog, [
    ...rivers,
    {
      scope,
      reference: { kind: "layer", id: "rivers", revision: 0 },
      data: { kind: "layer", value: builtinLayers().find((layer) => layer.id === "rivers")! },
    },
    ...[0, 500, 1500].map((x, i) => ({
      scope,
      reference: { kind: "node" as const, id: `n${i}`, revision: 0 },
      data: {
        kind: "node" as const,
        value: {
          id: `n${i}`,
          kind: "river",
          position: { x, y: 50, z: 0 },
          spaceId: scope.spaceId,
          waterLevel: null,
        },
      },
    })),
    ...rivers.map((river, i) => ({
      scope,
      reference: { kind: "reach" as const, id: `r${i}`, revision: 0 },
      data: {
        kind: "reach" as const,
        value: {
          id: `r${i}`,
          featureId: river.reference.id,
          start: `n${i}`,
          end: `n${i + 1}`,
          geometry:
            river.data.kind === "feature" ? river.data.value.geometry : rectangle([0, 0, 1, 1]),
          flow: 3,
          endFlow: 4,
        },
      },
    })),
  ]);
  const source = await generationSource(catalog, scope.worldId, scope.areaId);
  source.scope.footprint = rectangle([0, 0, 200, 200]);
  await loadGenerationFeatures(source, catalog, features, undefined, networks);
  expect(features.get("river-b")).toBeDefined();
  expect([...networks.reaches({ nodeId: "n1" })].map((reach) => reach.id).sort()).toEqual([
    "r0",
    "r1",
  ]);
  expect(networks.node("n2")!.position.x).toBe(1500);
  expect(networks.reach("r1")).toMatchObject({ flow: 3, endFlow: 4 });
  expect(source.world.networkNodes).toEqual({});
  expect(source.world.networkReaches).toEqual({});
});
it("retains authored finer representations when their owner lies on another page", async () => {
  const { catalog, features } = await sourceFixture();
  const root = (await catalog.readRecords(scope, "area", [scope.areaId]))[0];
  if (root.data.kind !== "area") throw new Error("Expected an area");
  const childScope = { ...scope, areaId: "child" };
  await write(catalog, [
    {
      scope: childScope,
      reference: { kind: "area", id: "child", revision: 0 },
      data: {
        kind: "area",
        value: {
          ...root.data.value,
          id: "child",
          parentId: scope.areaId,
          profile: "region",
          footprint: rectangle([20, 20, 80, 80]),
        },
      },
    },
    {
      scope: childScope,
      reference: { kind: "representation", id: "authored-detail", revision: 0 },
      data: {
        kind: "representation",
        value: {
          id: "authored-detail",
          featureId: "feature-129",
          areaId: "child",
          geometry: rectangle([30, 30, 70, 70]),
          attributes: { owner: "creator" },
          state: "authored",
          actor: "creator",
          protected: true,
          mapOnly: true,
          generationId: null,
          needsReconciliation: false,
        },
      },
    },
  ]);
  const source = await generationSource(catalog, scope.worldId, scope.areaId);
  await loadGenerationFeatures(source, catalog, features);
  expect(features.get("feature-129")!.detail.child).toMatchObject({
    id: "authored-detail",
    protected: true,
    mapOnly: true,
    attributes: { owner: "creator" },
  });
  expect(source.world.areas.child.parentId).toBe(scope.areaId);
  expect(source.revisions.find((r) => r.id === "authored-detail")?.version).toBe(
    source.world.version
  );
});
it("publishes removals from a stored baseline and restores the full representation on undo", async () => {
  const { catalog, features: sourceFeatures } = await sourceFixture();
  await write(catalog, [
    {
      scope,
      reference: { kind: "representation", id: "removed-detail", revision: 0 },
      data: {
        kind: "representation",
        value: {
          id: "removed-detail",
          attributes: {},
          featureId: "feature-129",
          areaId: scope.areaId,
          geometry: rectangle([20, 20, 80, 80]),
          state: "generated",
          actor: "generator",
          protected: false,
          generationId: null,
          needsReconciliation: false,
        },
      },
    },
  ]);
  const source = await generationSource(catalog, scope.worldId, scope.areaId);
  await loadGenerationFeatures(source, catalog, sourceFeatures);
  let features!: SqliteFeatureWorkspace;
  await fixture((db) => {
    features = new SqliteFeatureWorkspace(db);
  });
  for (const feature of sourceFeatures.values()) features.put(feature);
  features.remove("feature-129");
  const renamed = features.get("feature-128")!;
  renamed.name = "Regenerated woodland";
  features.put(renamed);
  const unused = () => {
    throw new Error("Vector publication must not read numerical storage");
  };
  const resources = new ZarrResources({
    get: unused,
    set: unused,
    deletePrefix: unused,
    snapshot: unused,
  });
  const operationId = crypto.randomUUID();
  await publishWorkspaceGeneration(
    catalog,
    resources,
    source,
    structuredClone(source),
    operationId,
    false,
    [],
    () => {},
    undefined,
    { features, sourceFeatures }
  );
  expect(await catalog.readRecords(scope, "feature", ["feature-129"])).toEqual([]);
  expect(await catalog.readRecords(scope, "representation", ["removed-detail"])).toEqual([]);
  expect((await catalog.readFeature(scope, "feature-128")).name).toBe("Regenerated woodland");
  await catalog.undo(scope.worldId, operationId);
  expect(await catalog.readRecords(scope, "representation", ["removed-detail"])).toHaveLength(1);
  expect(spatial.area((await catalog.readFeature(scope, "feature-129")).geometry)).toBe(3600);
  expect((await catalog.readFeature(scope, "feature-128")).name).toBe("feature-128");
});

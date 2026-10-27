import { expect, it } from "vitest";
import { restoreMappedEdits, type DomainSnapshot } from "@atlas/domain";
import { fixture, scope } from "./catalogFixture";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { SqliteNetworkWorkspace } from "./networkWorkspace";
import { landscape } from "../../generation/src/mapFixtures";
import { generatedFeature, putGeneratedNetwork } from "../../generation/src/mapFeatures";
import { initializeFeatureWorkspace } from "../../generation/src/generationFeatures";
import { initializeNetworkWorkspace } from "../../generation/src/generationNetworks";
import { retainGeographicIdentities } from "../../generation/src/canonry/geographicIdentity";

async function working() {
  let stores!: {
    features: SqliteFeatureWorkspace;
    sourceFeatures: SqliteFeatureWorkspace;
    networks: SqliteNetworkWorkspace;
    sourceNetworks: SqliteNetworkWorkspace;
  };
  await fixture((db) => {
    stores = {
      features: new SqliteFeatureWorkspace(db),
      sourceFeatures: new SqliteFeatureWorkspace(db, "source_features"),
      networks: new SqliteNetworkWorkspace(db),
      sourceNetworks: new SqliteNetworkWorkspace(db, "source_networks"),
    };
  });
  const state = landscape();
  state.domain.world.id = state.domain.scope.worldId = state.surface.scope.worldId = scope.worldId;
  return { ...stores, state };
}
function river(state: ReturnType<typeof landscape>, key: string, coordinates: number[][]) {
  return generatedFeature(
    state,
    key,
    key,
    "river",
    "rivers",
    { type: "LineString", coordinates },
    {
      sourceAlgorithm: "canonry-0f62584c",
      elevations: [150, 100],
      discharge: 3,
      discharges: [3, 4],
    }
  );
}
function storeSource(stores: Awaited<ReturnType<typeof working>>, original: DomainSnapshot) {
  for (const feature of Object.values(original.world.features)) stores.sourceFeatures.put(feature);
  for (const node of Object.values(original.world.networkNodes ?? {}))
    stores.sourceNetworks.putNode(node);
  for (const reach of Object.values(original.world.networkReaches ?? {}))
    stores.sourceNetworks.putReach(reach);
  original.world.features = {};
  original.world.networkNodes = {};
  original.world.networkReaches = {};
  stores.state.domain = structuredClone(original);
  stores.state.sourceFeatures = stores.sourceFeatures;
  stores.state.sourceNetworks = stores.sourceNetworks;
  initializeFeatureWorkspace(stores.state, stores.features);
  initializeNetworkWorkspace(stores.state, stores.networks);
}
it("queries connected reaches through indexed endpoints and keeps detached writes explicit", async () => {
  const { networks } = await working();
  for (let i = 0; i < 140; i++)
    networks.putReach({
      id: `reach-${i}`,
      featureId: `feature-${i % 2}`,
      start: `node-${i}`,
      end: `node-${i + 1}`,
      geometry: {
        type: "LineString",
        coordinates: [
          [i, 0],
          [i + 1, 0],
        ],
      },
      flow: i,
      endFlow: i + 1,
    });
  expect([...networks.reaches({ featureId: "feature-1" })]).toHaveLength(70);
  const connected = [...networks.reaches({ nodeId: "node-70" })];
  expect(connected.map((reach) => reach.id)).toEqual(["reach-69", "reach-70"]);
  connected[0].end = "moved-junction";
  expect(networks.reach("reach-69")!.end).toBe("node-70");
  networks.putReach(connected[0]);
  expect([...networks.reaches({ nodeId: "node-70" })].map((reach) => reach.id)).toEqual([
    "reach-70",
  ]);
  expect([...networks.reaches({ nodeId: "moved-junction" })].map((reach) => reach.id)).toEqual([
    "reach-69",
  ]);
});
it("anchors generated tributaries to a stored protected junction and preserves their flow", async () => {
  const stores = await working(),
    { state, features, networks, sourceFeatures, sourceNetworks } = stores;
  const old = river(state, "original", [
    [0, 500],
    [4000, 500],
  ]);
  old.protected = true;
  putGeneratedNetwork(state, old);
  const original = structuredClone(state.domain);
  storeSource(stores, original);
  features.put(old);
  const next = river(state, "resampled", [
    [20, 510],
    [4020, 510],
  ]);
  const tributary = river(state, "tributary", [
    [3000, 1000, 150],
    [4020, 510, 80],
  ]);
  putGeneratedNetwork(state, next);
  putGeneratedNetwork(state, tributary);
  retainGeographicIdentities(state, original, 50, new Set([next.id, tributary.id]));
  const main = [...networks.reaches({ featureId: old.id })][0];
  const branch = [...networks.reaches({ featureId: tributary.id })][0];
  expect(branch.end).toBe(main.end);
  expect(branch.geometry).toEqual({
    type: "LineString",
    coordinates: [
      [3000, 1000, 150],
      [4000, 500, 100],
    ],
  });
  expect(branch.flow).toBe(3);
  expect(branch.endFlow).toBe(4);
  expect(features.get(tributary.id)!.geometry).toEqual(branch.geometry);
  expect(features.get(old.id)).toEqual(sourceFeatures.get(old.id));
  expect(networks.node(branch.end)).toEqual(sourceNetworks.node(main.end));
  expect(state.domain.world.networkReaches).toEqual({});
  expect(original.world.features).toEqual({});
});
it("omits map-only networks from simulation and restores them from the immutable baseline", async () => {
  const stores = await working(),
    { state, features, networks, sourceNetworks } = stores;
  const drawing = {
    ...river(state, "drawn", [
      [0, 500],
      [4000, 500],
    ]),
    mapOnly: true,
  };
  putGeneratedNetwork(state, drawing);
  const original = structuredClone(state.domain);
  storeSource(stores, original);
  expect([...networks.reaches()]).toEqual([]);
  expect(features.get(drawing.id)).toBeUndefined();
  restoreMappedEdits(state.domain, original, stores);
  const reach = [...networks.reaches()][0];
  expect(reach).toEqual([...sourceNetworks.reaches()][0]);
  expect(features.get(drawing.id)).toEqual(drawing);
  expect(networks.node(reach.start)).toEqual(sourceNetworks.node(reach.start));
  expect(state.domain.world.networkReaches).toEqual({});
});

import {
  openGenerationWorkspace,
  OpfsStore,
  ZarrResources,
  GeometryKernel,
  GeosSpatial,
} from "@atlas/storage-browser";
import {
  rectangle,
  type AtlasFeature,
  type DomainSnapshot,
  type NetworkWorkspace,
  type FeatureWorkspace,
  createGrid,
  fieldContour,
  spatial,
  configureSpatial,
} from "@atlas/domain";
import { WorkspaceClient } from "../src/WorkspaceClient";
import { publishWorkspaceGeneration } from "../src/generationPublication";
import { loadGenerationFeatures } from "../src/generationInputs";

export interface GenerationExample {
  count: number;
  name: string;
  restored: number;
  network: { flow: number; endpoints: number; afterUndo: number };
  contourArea: number;
}

/** Constructed records exercise the production scratch-to-catalog boundary without generation. */
self.onmessage = async (
  event: MessageEvent<{ source: DomainSnapshot; port: MessagePort; id: string }>
) => {
  const { source, port, id } = event.data;
  let result: GenerationExample | { error: string };
  try {
    result = await publishExample(source, new WorkspaceClient(port), id);
  } catch (error) {
    result = { error: String(error) };
  } finally {
    port.close();
  }
  self.postMessage(result);
};
async function publishExample(source: DomainSnapshot, workspace: WorkspaceClient, id: string) {
  const working = await openGenerationWorkspace(`example_${id}`);
  let kernel: GeometryKernel | undefined;
  try {
    const geometry = (kernel = await GeometryKernel.create());
    configureSpatial((precision) => new GeosSpatial(geometry, precision));
    await loadGenerationFeatures(
      source,
      workspace,
      working.sourceFeatures,
      undefined,
      working.sourceNetworks
    );
    for (const feature of working.sourceFeatures.values()) working.features.put(feature);
    for (const reach of working.sourceNetworks.reaches()) working.networks.putReach(reach);
    for (const node of working.sourceNetworks.nodes()) working.networks.putNode(node);
    for (let i = 0; i < 150; i++) working.features.put(exampleFeature(source, i));
    exampleNetwork(source, working.features, working.networks);
    const contour = fieldContour(
      createGrid(
        "stored-contour",
        { ...source.scope, footprint: rectangle([0, 0, 100, 100]) },
        9,
        9
      ),
      (x) => x - 50,
      undefined,
      0,
      undefined,
      working.contours
    )!;
    const snapshot = structuredClone(source);
    snapshot.world.features = {};
    const resources = new ZarrResources(await OpfsStore.open("atlas-resources"));
    await publishWorkspaceGeneration(
      workspace,
      resources,
      source,
      snapshot,
      id,
      false,
      [],
      () => {},
      undefined,
      working
    );
    const count = (await workspace.readWorld(source.world.id)).featureCount ?? 0;
    const page = await workspace.readFeatures({
      scope: source.scope,
      extent: [200, 200, 250, 250],
      geometry: null,
      predicate: "intersects",
      layers: ["ecology"],
      limit: 200,
      after: null,
    });
    const network = await networkResult(workspace, source, id);
    return {
      count,
      name: page.records[0].feature.name,
      restored: (await workspace.readWorld(source.world.id)).featureCount ?? 0,
      network,
      contourArea: spatial.area(contour),
    };
  } finally {
    try {
      await working.close();
    } finally {
      configureSpatial();
      kernel?.close();
    }
  }
}
async function networkResult(
  workspace: WorkspaceClient,
  source: DomainSnapshot,
  operationId: string
) {
  const reach = (await workspace.readRecords(source.scope, "reach", ["stored-reach"]))[0];
  if (reach?.data.kind !== "reach") throw new Error("The generated network reach is missing.");
  const endpoints = (
    await workspace.readRecords(source.scope, "node", [
      reach.data.value.start,
      reach.data.value.end,
    ])
  ).length;
  await workspace.undo(source.world.id, operationId);
  return {
    flow: reach.data.value.flow,
    endpoints,
    afterUndo: (await workspace.readRecords(source.scope, "reach", ["stored-reach"])).length,
  };
}
function exampleNetwork(
  source: DomainSnapshot,
  features: FeatureWorkspace,
  networks: NetworkWorkspace
) {
  const coordinates = [
    [100, 100],
    [800, 800],
  ];
  const feature: AtlasFeature = {
    ...exampleFeature(source, 150),
    kind: "river",
    layerId: "rivers",
    geometry: { type: "LineString", coordinates },
  };
  features.put(feature);
  for (const [i, [x, y]] of coordinates.entries())
    networks.putNode({
      id: `stored-node-${i}`,
      kind: "river",
      position: { x, y, z: 0 },
      spaceId: source.scope.spaceId,
      waterLevel: null,
    });
  networks.putReach({
    id: "stored-reach",
    featureId: feature.id,
    start: "stored-node-0",
    end: "stored-node-1",
    geometry: feature.geometry,
    flow: 42,
    endFlow: 42,
  });
}
function exampleFeature(source: DomainSnapshot, index: number): AtlasFeature {
  return {
    id: `scratch-feature-${String(index).padStart(3, "0")}`,
    areaId: source.scope.areaId,
    layerId: "ecology",
    name: "Stored woodland",
    kind: "forest",
    geometry: rectangle([200, 200, 250, 250]),
    detail: {},
    attributes: {},
    relations: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    causes: [],
  };
}

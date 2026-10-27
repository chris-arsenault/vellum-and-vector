import {
  rectangle,
  createWorldBlueprint,
  builtinLayers,
  type CatalogRecord,
  type WorldMetadata,
  type WorkspaceScope,
} from "@atlas/domain";
import { WorkspaceClient } from "../src/WorkspaceClient";
import { openSpatialRuntime } from "../src/spatialRuntime";
import type { GenerationExample } from "./workspaceFeatures.worker";

await openSpatialRuntime();

function exampleWorld(scope: WorkspaceScope): WorldMetadata {
  return {
    id: scope.worldId,
    name: "Storage example",
    seed: 7,
    version: 1,
    owner: "creator",
    reference: {
      id: "metres",
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "Sea level",
      precision: 0.000001,
      version: 1,
      domain: rectangle([0, 0, 1000, 1000]),
    },
    layers: Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer])),
    fields: [],
    magic: [],
    landmarks: [],
    views: [],
    generations: [],
    epochs: [],
  };
}
async function catalogExample() {
  const name = crypto.randomUUID(),
    client = new WorkspaceClient(
      new Worker(new URL("../src/workspace.worker.ts", import.meta.url), { type: "module" })
    );
  const scope = {
    worldId: crypto.randomUUID(),
    spaceId: crypto.randomUUID(),
    areaId: crypto.randomUUID(),
  };
  const world = exampleWorld(scope);
  const record: CatalogRecord = {
    scope,
    reference: { kind: "feature", id: "wood", revision: 0 },
    data: {
      kind: "feature",
      value: {
        id: "wood",
        areaId: scope.areaId,
        layerId: "ecology",
        name: "Woodland",
        kind: "forest",
        geometry: rectangle([10, 10, 100, 100]),
        detail: {},
        attributes: {},
        relations: [],
        state: "generated",
        protected: false,
        actor: "generator",
        generationId: null,
        causes: [],
      },
    },
  };
  await seedCatalog(client, name, world, record);
  const reopened = new WorkspaceClient(
    new Worker(new URL("../src/workspace.worker.ts", import.meta.url), { type: "module" })
  );
  await reopened.open(name);
  try {
    const commands = await commandExample(reopened, scope);
    const result = await reopened.readFeatures({
      scope,
      extent: [10, 50, 10, 50],
      geometry: { type: "Point", coordinates: [10, 50] },
      predicate: "covers",
      layers: ["ecology"],
      after: null,
      limit: 10,
    });
    return {
      name: result.records[0]?.feature.name,
      revision: (await reopened.readWorld(scope.worldId)).version,
      commands,
      generation: await featureExample(reopened, scope),
    };
  } finally {
    await reopened.close();
  }
}
async function featureExample(client: WorkspaceClient, scope: WorkspaceScope) {
  const worker = new Worker(new URL("./workspaceFeatures.worker.ts", import.meta.url), {
    type: "module",
  });
  const channel = new MessageChannel();
  try {
    await client.connect(channel.port1);
    const source = await client.generationSource(scope.worldId, scope.areaId);
    return await new Promise<GenerationExample>((resolve, reject) => {
      worker.onmessage = (event) =>
        "error" in event.data ? reject(new Error(event.data.error)) : resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ source, port: channel.port2, id: crypto.randomUUID() }, [channel.port2]);
    });
  } finally {
    worker.terminate();
    channel.port1.close();
    channel.port2.close();
  }
}
async function commandExample(client: WorkspaceClient, scope: WorkspaceScope) {
  const operationId = crypto.randomUUID();
  const input = {
    scope,
    preview: true,
    command: {
      operationId,
      expectedVersion: 2,
      kind: "renameArea",
      data: { id: scope.areaId, name: "New name" },
    },
  };
  const preview = await client.executeCommand(input);
  if (preview.change || (await client.readWorld(scope.worldId)).version !== 2)
    throw new Error("A preview must not publish changes.");
  await client.executeCommand({ ...input, preview: false });
  const readName = async () => {
    const record = (await client.readRecords(scope, "area", [scope.areaId]))[0];
    if (record.data.kind !== "area") throw new Error("The root area is missing.");
    return record.data.value.name;
  };
  const renamed = await readName();
  await client.undo(scope.worldId, operationId);
  const restored = await readName();
  return { renamed, restored, field: await fieldCommandExample(client, scope) };
}
async function fieldCommandExample(client: WorkspaceClient, scope: WorkspaceScope) {
  const execute = async (kind: string, data: Record<string, unknown>) =>
    client.executeCommand({
      scope,
      preview: false,
      command: {
        operationId: crypto.randomUUID(),
        expectedVersion: (await client.readWorld(scope.worldId)).version,
        kind,
        data,
      },
    });
  await execute("createField", {
    areaId: scope.areaId,
    layerId: "elevation",
    resolution: 9,
    value: 0,
  });
  const sculpted = await execute("sculptField", {
    areaId: scope.areaId,
    channel: "elevation",
    center: { x: 500, y: 500, z: 0 },
    radius: 100,
    delta: 50,
  });
  const patch = sculpted.change!.records.find((r) => r.kind === "fieldPatch")!;
  const record = (await client.readRecords(scope, "fieldPatch", [patch.id]))[0];
  if (record.data.kind !== "fieldPatch") throw new Error("The sculpted patch is missing.");
  const peak = await sampleCommandField(record.data.value.resourceId);
  await client.undo(scope.worldId, sculpted.change!.operationId);
  return {
    peak: peak.maximum,
    peakPosition: peak.position,
    patchesAfterUndo: (await client.readRecords(scope, "fieldPatch", [patch.id])).length,
  };
}
function sampleCommandField(id: string) {
  const worker = new Worker(new URL("./workspaceResources.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<{ maximum: number; position: number[] }>((resolve, reject) => {
    worker.onmessage = (
      event: MessageEvent<{ maximum: number; position: number[] } | { error: string }>
    ) => {
      worker.terminate();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ kind: "fieldSamples", id });
  });
}
async function seedCatalog(
  client: WorkspaceClient,
  name: string,
  world: WorldMetadata,
  record: CatalogRecord
) {
  await client.open(name);
  try {
    await client.createWorld(world);
    const blueprint = createWorldBlueprint({
      id: world.id,
      name: world.name,
      rootName: world.name,
      seed: world.seed,
      reference: world.reference,
    });
    const root: CatalogRecord = {
      scope: record.scope,
      reference: { kind: "area", id: record.scope.areaId, revision: 0 },
      data: {
        kind: "area",
        value: { ...blueprint.root, id: record.scope.areaId, spaceId: record.scope.spaceId },
      },
    };
    await client.commit({
      operationId: "place",
      worldId: world.id,
      expected: [root.reference, record.reference],
      writes: [root, record],
      removes: [],
      resources: [],
    });
  } finally {
    await client.close();
  }
}
interface WorkingExample {
  samples: number[];
  writes: number;
  peakDecodedBytes: number;
}
interface FieldsExample {
  samples: number[];
  partitions: number;
  shared: string[];
  input: {
    openedFiles: number;
    peakFiles: number;
    reads: number;
    readBytes: number;
    openingMs: number;
    scratchWriteBytes: number;
  };
}
function resourceExample() {
  const worker = new Worker(new URL("./workspaceResources.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<{ samples: number[]; working: WorkingExample; fields: FieldsExample }>(
    (resolve, reject) => {
      worker.onmessage = (
        event: MessageEvent<
          { values: number[]; working: WorkingExample; fields: FieldsExample } | { error: string }
        >
      ) => {
        worker.terminate();
        if ("error" in event.data) reject(new Error(event.data.error));
        else
          resolve({
            samples: event.data.values,
            working: event.data.working,
            fields: event.data.fields,
          });
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage(crypto.randomUUID());
    }
  );
}
declare global {
  interface Window {
    workspaceExample(): Promise<{
      catalog: {
        name: string;
        revision: number;
        generation: GenerationExample;
        commands: {
          renamed: string;
          restored: string;
          field: { peak: number; peakPosition: number[]; patchesAfterUndo: number };
        };
      };
      samples: number[];
      working: WorkingExample;
      fields: FieldsExample;
    }>;
  }
}
window.workspaceExample = async () => {
  const catalog = await catalogExample(),
    resources = await resourceExample();
  return { catalog, ...resources };
};

import { createWorldSnapshot } from "../src/worldCreation";
import { planCommand } from "@atlas/application";
import { gridPosition, gridSampler, projectChanges } from "@atlas/domain";
import type { LegacySavedWorld } from "../src/legacySave";
import { openSpatialRuntime } from "../src/spatialRuntime";

/** Construct the released save format, including typed samples and inverse states. */
export async function installLegacySave() {
  const closeSpatial = await openSpatialRuntime();
  try {
    const { world, areaId, data } = legacyData();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vellum-and-vector-maps", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("maps");
        request.result.createObjectStore("summaries", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["maps", "summaries"], "readwrite");
        tx.objectStore("maps").put({ format: 1, data }, world.id);
        tx.objectStore("summaries").put({
          id: world.id,
          name: world.name,
          version: data.snapshot.world.version,
          savedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    const grid = Object.values(data.snapshot.numerical)[0];
    const sample = gridSampler(grid, "elevation");
    let maximum = -Infinity;
    for (let i = 0; i < grid.active.length; i++)
      if (grid.active[i]) maximum = Math.max(maximum, sample(gridPosition(grid, i)));
    return { id: world.id, areaId, history: data.history, maximum };
  } finally {
    closeSpatial();
  }
}

function legacyData() {
  const snapshot = createWorldSnapshot({
    name: "Legacy atlas",
    seed: 17,
    width: 1000,
    height: 1000,
  });
  const world = snapshot.world;
  const saved: LegacySavedWorld = { snapshot, history: [], undo: [], causes: {} };
  const areaId = Object.keys(world.areas)[0];
  const command = (kind: string, data: Record<string, unknown>) => {
    const input = {
      kind,
      data,
      operationId: crypto.randomUUID(),
      expectedVersion: saved.snapshot.world.version,
    };
    const changes = planCommand(saved.snapshot, input).evaluate(saved.snapshot);
    saved.undo.push(saved.snapshot);
    saved.snapshot = projectChanges(saved.snapshot, changes);
    saved.snapshot.scope = { ...saved.snapshot.scope, revision: saved.snapshot.world.version };
    saved.history.unshift({
      operationId: input.operationId,
      version: saved.snapshot.world.version,
      actor: "user",
      kind,
      at: new Date().toISOString(),
    });
  };
  command("createField", { areaId, layerId: "elevation", resolution: 9, value: 100 });
  command("sculptField", {
    areaId,
    channel: "elevation",
    center: { x: 500, y: 500, z: 0 },
    radius: 100,
    delta: 50,
  });
  command("renameArea", { id: areaId, name: "Renamed legacy root" });
  const data = saved;
  data.causes[areaId] = [
    {
      path: ["physical", "formation"],
      ancestry: [],
      causes: [
        {
          kind: "domain",
          process: "formation",
          subjects: [areaId],
          description: "Retained formation history",
        },
      ],
    },
  ];
  return { world, areaId, data };
}

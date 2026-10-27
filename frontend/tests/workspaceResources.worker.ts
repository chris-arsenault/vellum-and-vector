import {
  OpfsStore,
  ZarrResources,
  openNumericalArena,
  FieldWorkingSet,
  writeFieldLayout,
  writeFieldChannels,
} from "@atlas/storage-browser";
import { createGrid, putChannel, rectangle, type NumericalResource } from "@atlas/domain";
import { openSpatialRuntime } from "../src/spatialRuntime";

async function exercise(id: string) {
  const store = await OpfsStore.open("atlas-resource-example"),
    resources = new ZarrResources(store);
  const resource: NumericalResource = {
    id,
    schemaVersion: 1,
    revision: 1,
    state: "working",
    layout: "regular",
    scope: { worldId: "example", spaceId: "surface", areaId: "root" },
    bounds: [0, 0, 200, 100],
    crsId: "metres",
    precision: 0.000001,
    arrays: ["elevation", "heat"].map((name) => ({
      name,
      dtype: "float64",
      shape: [8],
      chunkShape: [4],
      unit: "metre",
      quantity: "intensive",
    })),
    partitions: [0, 1].map((i) => ({
      id: String(i),
      bounds: [i * 100, 0, (i + 1) * 100, 100],
      cellStart: i * 4,
      cellCount: 4,
      neighbors: [String(1 - i)],
    })),
  };
  await resources.create(resource);
  for (const reference of resource.partitions)
    await resources.writePartition(id, {
      reference,
      arrays: { elevation: Float64Array.of(1, 2, 3, 4), heat: Float64Array.of(10, 20, 30, 40) },
    });
  await resources.finish(id);
  const reopened = new ZarrResources(store),
    values: number[] = [];
  for await (const partition of reopened.readWindow({
    resourceId: id,
    arrays: ["elevation"],
    extent: [1, 1, 99, 99],
    halo: 0,
  }))
    values.push(...partition.arrays.elevation);
  await reopened.remove(id);
  return values;
}
async function exerciseWorking(id: string) {
  const working = await openNumericalArena(id, 262_144);
  try {
    const values = working.arena.allocate({
      type: "float64",
      length: 200_000,
      lifetime: "run",
      name: "access-example",
    });
    for (let start = 0; start < values.length; start += 16_384) {
      const chunk = Float64Array.from(
        { length: Math.min(16_384, values.length - start) },
        (_, i) => start + i + 1
      );
      working.arena.write(values, start, chunk);
    }
    working.arena.flush();
    return { samples: [values[0], values[99_999], values[199_999]], ...working.arena.stats };
  } finally {
    await working.close();
  }
}
async function exerciseFields(id: string) {
  const store = await OpfsStore.open("atlas-resource-example"),
    resources = new ZarrResources(store);
  const working = await openNumericalArena(`${id}_fields`, 262_144);
  const fields = new FieldWorkingSet(resources, working.arena);
  const layoutId = `${id}:layout`,
    fieldId = `${id}:field`;
  try {
    const grid = createGrid(
      "surface",
      {
        worldId: "example",
        spaceId: "surface",
        areaId: "root",
        footprint: rectangle([0, 0, 1000, 1000]),
        crsId: "metres",
        revision: 1,
        time: "present",
        resolution: 1,
      },
      517,
      71,
      undefined,
      working.arena
    );
    const values = working.arena.allocate({
      type: "float64",
      length: grid.active.length,
      lifetime: "run",
      name: "height",
    });
    for (let i = 0; i < values.length; i++) values[i] = i + 0.25;
    putChannel(grid, "height", "metre", values);
    const layout = await writeFieldLayout(resources, grid, layoutId, 0.000001);
    const resource = await writeFieldChannels(resources, grid, fieldId, layout);
    const writtenBefore = working.arena.stats.writtenBytes;
    const loaded = await fields.load(fieldId, ["height"], layout.geography);
    const samples = [loaded.channels.height[0], loaded.channels.height.at(-1)];
    return {
      samples,
      input: {
        ...store.inputStats,
        scratchWriteBytes: working.arena.stats.writtenBytes - writtenBefore,
      },
      partitions: resource.partitions.length,
      shared: resource.arrays.filter((array) => array.source).map((array) => array.name),
    };
  } finally {
    fields.close();
    await working.close();
    await resources.remove(fieldId);
    await resources.remove(layoutId);
  }
}
async function sampleField(id: string) {
  const resources = new ZarrResources(await OpfsStore.open("atlas-resources"));
  const resource = await resources.describe(id),
    names = Object.values(resource.field!.channels);
  let maximum = -Infinity;
  let position = [NaN, NaN];
  for await (const partition of resources.readWindow({
    resourceId: id,
    arrays: [...names, "cellBounds", "active"],
    extent: resource.bounds,
    halo: 0,
  }))
    for (const name of names) {
      const samples = partition.arrays[name],
        bounds = partition.arrays.cellBounds;
      if (!samples) continue;
      for (let i = 0; i < samples.length; i++) {
        if (!partition.arrays.active[i] || samples[i] <= maximum) continue;
        maximum = samples[i];
        position = [
          (bounds[i * 4] + bounds[i * 4 + 2]) / 2,
          (bounds[i * 4 + 1] + bounds[i * 4 + 3]) / 2,
        ];
      }
    }
  return { maximum, position };
}
self.onmessage = async (event: MessageEvent<string | { kind: "fieldSamples"; id: string }>) => {
  const closeSpatial = await openSpatialRuntime();
  try {
    if (typeof event.data !== "string") {
      self.postMessage(await sampleField(event.data.id));
      return;
    }
    self.postMessage({
      values: await exercise(event.data),
      working: await exerciseWorking(event.data),
      fields: await exerciseFields(event.data),
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    closeSpatial();
  }
};

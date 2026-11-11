import { requireChannel } from "@atlas/domain";
import { afterEach, expect, it } from "vitest";
import {
  cloneFieldInput,
  Band,
  createGrid,
  generateBand,
  gridSchema,
  putChannel,
  rectangle,
  type SpatialScope,
} from "@atlas/domain";
import { writeFieldChannels, writeFieldLayout } from "./fieldResources";
import { FieldWorkingSet } from "./fieldWorkingSet";
import { ZarrResources } from "./zarrResources";
import { blockCacheFixture } from "./blockCacheFixture";
import { fileStoreFixture } from "./fileStoreFixture";
import { appendFieldCargo } from "./fieldCargo";
import {
  fieldPartitionSamples,
  layoutVector,
  regularPartitions,
  resourceBase,
} from "./fieldLayout";
import { arraySelection } from "./resourceVectors";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close())
);
function fixture() {
  const files = fileStoreFixture(),
    blocks = blockCacheFixture(),
    resources = new ZarrResources(files.store),
    working = new FieldWorkingSet(resources, blocks.cache);
  cleanup.push(
    () => files.close(),
    () => blocks.close(),
    () => working.close()
  );
  const scope: SpatialScope = {
    worldId: "world",
    areaId: "root",
    spaceId: "world",
    crsId: "world:metres",
    revision: 1,
    time: "present",
    resolution: 1,
    footprint: rectangle([0, 0, 1000, 1000]),
  };
  return { resources, working, grid: createGrid<string>("cargo", scope, 3, 3) };
}
it("publishes sparse material cargo with immutable named records and independent working copies", async () => {
  const { grid, resources, working } = fixture();
  putChannel(
    grid,
    "height",
    "metre",
    generateBand(grid.coverage, "float64", "height", () => 3)
  );
  const offsets = grid.coverage.scratch("uint32", "cargo-offsets", 10),
    records = grid.coverage.scratch("float64", "cargo-records", 8);
  for (let cell = 1; cell < 10; cell++) offsets.set(cell, 2);
  [0, 1, 12, 4, 1, 2, 13, 6].forEach((value, at) => records.set(at, value));
  grid.materialCargo = {
    keys: ["salt:sea/bed", "society:forge"],
    releasedTo: ["salt:sea/bed", "salt:sea/bed"],
    slots: ["land:0", "sea-load"],
    offsets,
    records,
  };
  const layout = await writeFieldLayout(resources, grid, "cargo-layout", 1e-6),
    resource = await writeFieldChannels(resources, grid, "cargo-field", layout),
    loaded = await working.load(resource.id, ["height"], layout.geography);
  expect(resource.field!.materialCargo?.keys).toEqual(["salt:sea/bed", "society:forge"]);
  expect(loaded.materialCargo!.releasedTo).toEqual(["salt:sea/bed", "salt:sea/bed"]);
  expect(Object.keys(loaded.channels)).toEqual(["height"]);
  expect(Array.from(loaded.materialCargo!.records)).toEqual([0, 1, 12, 4, 1, 2, 13, 6]);
  expect(loaded.materialCargo!.offsets.get(1)).toBe(2);
  expect(gridSchema.safeParse(loaded).success).toBe(true);
  expect(() => loaded.materialCargo!.records.set(3, 99)).toThrow(/Immutable/);
  const pinned = cloneFieldInput(loaded),
    editable = cloneFieldInput(grid);
  records.set(3, 99);
  expect(pinned.materialCargo!.records.get(3)).toBe(4);
  expect(editable.materialCargo!.records.get(3)).toBe(4);
  expect(pinned.materialCargo!.records).toBe(loaded.materialCargo!.records);
  expect(pinned.materialCargo!.releasedTo).not.toBe(loaded.materialCargo!.releasedTo);
  const chunks = resource.partitions.filter((partition) => partition.cellCount === 0);
  expect(chunks.map((partition) => Object.keys(partition.arraySlices!))).toEqual([
    ["material_offsets"],
    ["material_records"],
  ]);
  const window = [];
  for await (const partition of resources.readWindow({
    resourceId: resource.id,
    extent: grid.bounds,
    halo: 0,
    arrays: ["channel_0"],
  }))
    window.push(partition);
  expect(window.map((partition) => partition.reference.id)).toEqual(["cells:0:0"]);
});
it("cargo chunks own only sparse arrays regardless of the number of field channels", () => {
  const { grid } = fixture(),
    resource = resourceBase(grid, "sparse");
  resource.arrays = Array.from({ length: 128 }, (_, index) => ({
    ...layoutVector(`channel_${index}`, grid.measures, "cells").array,
    shape: [3, 3],
    chunkShape: [3, 3],
  }));
  resource.partitions = regularPartitions(grid, resource.arrays);
  resource.field = {
    id: grid.id,
    scope: grid.scope,
    layoutResourceId: "layout",
    geographyId: "geography",
    channels: {},
  };
  grid.materialCargo = {
    keys: ["greenwood:stand/stratum"],
    releasedTo: ["greenwood:stand/stratum"],
    slots: ["ground-load"],
    offsets: grid.coverage.scratch("uint32", "offsets", 10),
    records: grid.coverage.scratch("float64", "records", fieldPartitionSamples * 2 + 4),
  };
  appendFieldCargo(grid, resource);
  expect(resource.partitions[0].cellCount).toBe(9);
  const cargo = resource.partitions.slice(1);
  expect(cargo).toHaveLength(4);
  for (const partition of cargo) {
    expect(partition.cellCount).toBe(0);
    expect(Object.keys(partition.arraySlices!)).toEqual([partition.id.split(":")[0]]);
    expect(arraySelection(resource.arrays[0], partition)).toEqual({
      offset: [0, 0],
      shape: [0, 0],
    });
  }
});
it("retains an explicitly empty cargo table without manufacturing charged hosts", async () => {
  const { grid, resources, working } = fixture();
  putChannel(
    grid,
    "height",
    "metre",
    generateBand(grid.coverage, "float64", "height", () => 3)
  );
  grid.materialCargo = {
    keys: [],
    releasedTo: [],
    slots: ["land:0"],
    offsets: grid.coverage.scratch("uint32", "empty-offsets", 10),
    records: grid.coverage.scratch("float64", "empty-records", 0),
  };
  const layout = await writeFieldLayout(resources, grid, "empty-layout", 1e-6);
  await writeFieldChannels(resources, grid, "empty-field", layout);
  const loaded = await working.load("empty-field", ["height"], layout.geography);
  expect(loaded.materialCargo!.records.length).toBe(0);
  expect(loaded.materialCargo!.offsets.get(9)).toBe(0);
});

it("stores native physical samples without changing their units or sample types", async () => {
  const { grid, resources, working } = fixture();
  putChannel(
    grid,
    "Temperature",
    "native-temperature",
    generateBand(grid.coverage, "int32", "Temperature", () => 450)
  );
  putChannel(
    grid,
    "Rainfall",
    "millimetre/year",
    generateBand(grid.coverage, "float32", "Rainfall", () => 1200)
  );
  const layout = await writeFieldLayout(resources, grid, "physical-layout", 1e-6);
  await writeFieldChannels(resources, grid, "physical-channels", layout);
  const loaded = await working.load(
    "physical-channels",
    ["Temperature", "Rainfall"],
    layout.geography
  );
  expect(requireChannel(loaded, "Temperature").type).toBe("int32");
  expect(requireChannel(loaded, "Rainfall").type).toBe("float32");
  expect(requireChannel(loaded, "Temperature").get(0)).toBe(450);
  expect(requireChannel(loaded, "Rainfall").get(0)).toBe(1200);
  expect(loaded.units).toEqual({ Temperature: "native-temperature", Rainfall: "millimetre/year" });
  expect(() => gridSchema.parse(loaded)).not.toThrow();
});

it("publishes channel bands over different offsets of one source buffer", async () => {
  const { grid, resources, working } = fixture();
  const values = Float64Array.from({ length: 18 }, (_, i) => i + 0.5),
    over = (start: number, end: number, name: string) =>
      Band.over(
        values.subarray(start, end),
        { name, type: "float64", lifetime: "run" },
        grid.coverage.cache
      );
  putChannel(grid, "first", "metre", over(0, 9, "first"));
  putChannel(grid, "second", "metre", over(9, 18, "second"));
  const shared = await writeFieldLayout(resources, grid, "offset-layout", 1e-6);
  await writeFieldChannels(resources, grid, "offset-channels", shared);
  const input = await working.load("offset-channels", ["first", "second"], shared.geography);
  expect(Array.from(requireChannel(input, "first"))).toEqual(Array.from(values.subarray(0, 9)));
  expect(Array.from(requireChannel(input, "second"))).toEqual(Array.from(values.subarray(9)));
  expect(requireChannel(input, "second").get(0)).toBe(9.5);
  expect(values.byteLength).toBe(144);
});

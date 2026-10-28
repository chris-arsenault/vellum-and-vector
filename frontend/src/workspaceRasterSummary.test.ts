import { expect, it } from "vitest";
import { createGrid, generateBand, putChannel, rectangle, type FieldPatch } from "@atlas/domain";
import { ZarrResources, writeFieldLayout, writeFieldChannels } from "@atlas/storage-browser";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { mappedPatches, patchRanges, rasterCategorySummaries } from "./workspaceRasterSummary";
import type { FieldReference, ResourceRaster } from "./types";

it("keeps map-only drawings on their branch and applies them after procedural patches", () => {
  const world = landscape().domain.world,
    root = Object.values(world.areas)[0];
  world.areas.child = { ...root, id: "child", parentId: root.id };
  world.areas.sibling = { ...root, id: "sibling", parentId: root.id };
  const patch = (id: string, areaId: string, mapOnly: boolean) =>
    ({ id, areaId, mapOnly, fieldId: "field" }) as FieldPatch;
  const patches = [
    patch("child-drawing", "child", true),
    patch("sibling-drawing", "sibling", true),
    patch("procedural", "sibling", false),
    patch("root-drawing", root.id, true),
  ];
  expect(mappedPatches(world, "child", "field", patches).map((patch) => patch.id)).toEqual([
    "procedural",
    "root-drawing",
    "child-drawing",
  ]);
});
it("includes patch ranges and excludes classes hidden by patches and finer fields", async () => {
  const data = new Map<string, Uint8Array>();
  const store = new ZarrResources({
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
    },
    async deletePrefix(prefix) {
      for (const key of data.keys()) if (key.startsWith(prefix)) data.delete(key);
    },
    async snapshot(keys) {
      const values = new Map(keys.map((key) => [key, data.get(key)]));
      return { read: (key: string) => values.get(key), close: () => values.clear() };
    },
  });
  const domain = landscape().domain;
  async function field(
    id: string,
    extent: [number, number, number, number],
    code: number
  ): Promise<FieldReference> {
    const grid = createGrid(id, { ...domain.scope, footprint: rectangle(extent) }, 3, 3, extent);
    putChannel(
      grid,
      "cover",
      "category",
      generateBand(grid.coverage, "float64", "cover", () => code),
      "category"
    );
    const layout = await writeFieldLayout(store, grid, `${id}:layout`, 1e-6),
      resource = await writeFieldChannels(store, grid, id, layout);
    return {
      resourceId: id,
      scope: grid.scope,
      bounds: extent,
      units: grid.units,
      quantities: { cover: "category" },
      channels: resource.field!.summaries!,
      patches: [],
    };
  }
  const base = await field("base", [0, 0, 1000, 1000], 1);
  await field("patch", [0, 0, 1000, 1000], 7);
  base.patches.push({ resourceId: "patch", channels: ["cover"], mapOnly: true });
  await patchRanges(store, base);
  expect(base.channels.cover.range).toEqual([1, 7]);
  const raster = (id: string, reference: FieldReference): ResourceRaster => ({
    id,
    areaId: "root",
    field: reference,
    bounds: reference.bounds,
    footprint: reference.scope.footprint,
    channel: "cover",
    geography: {
      scope: reference.scope,
      areaId: "root",
      geographyId: `${id}:layout`,
      windows: [reference.bounds],
      tolerance: 0,
      revision: 1,
    },
  });
  const baseRaster = raster("base", base);
  await rasterCategorySummaries(store, [baseRaster]);
  expect(baseRaster.field.channels.cover.categories).toEqual([7]);
  const fine = raster("fine", await field("fine", [0, 0, 1000, 1000], 9));
  await rasterCategorySummaries(store, [baseRaster, fine]);
  expect(baseRaster.field.channels.cover.categories).toEqual([]);
  expect(fine.field.channels.cover.categories).toEqual([9]);
});

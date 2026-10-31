import { expect } from "vitest";
import {
  spatial,
  regionRefinementInput,
  refinedRegionArea,
  type DomainSnapshot,
} from "@atlas/domain";
import {
  generationSnapshot,
  refinementReads,
  type AtlasGenerationInput,
  type CompletedBoundary,
} from "@atlas/generation";
import {
  SqliteFeatureWorkspace,
  SqliteNetworkWorkspace,
  SqliteContourWorkspace,
  FieldInputCache,
  GeometryKernel,
  SpatialCatalog,
} from "@atlas/storage-browser";
import {
  sqliteFixture,
  reopenSqliteFixture,
} from "../../../packages/storage-browser/src/sqliteFixture";
import { blockCacheFixture } from "../../../packages/storage-browser/src/blockCacheFixture";
import { generationSource } from "../workspaceGeneration";
import { loadGenerationFeatures } from "../generationInputs";
import { WorkspaceFields } from "../workspaceFields";
import { publishWorkspaceGeneration } from "../generationPublication";
import { workspaceRasters } from "../workspaceRasters";
import { workspaceRasterGeography } from "../workspaceRasterGeography";
import { loadResourceRaster } from "../resourceRaster";
import { numericTileSampler } from "../numericTiles";
import { executeWorkspaceCommand } from "../workspaceCommands";
import type { refinementFixture } from "./regionalRefinementFixture";

type Fixture = Awaited<ReturnType<typeof refinementFixture>>;
export type RegionalWorkloadOutput = Awaited<
  ReturnType<Awaited<ReturnType<typeof regionalWorkload>>["publish"]>
>;

export function assertWorkloadDetail(
  result: CompletedBoundary,
  published: RegionalWorkloadOutput,
  branching = true
) {
  expect(result.state.physical).toBeUndefined();
  expect(result.state.society).toBeUndefined();
  expect(result.state.history).toEqual([]);
  const reaches = result.state.domain.world.drainage![result.state.surface.scope.areaId].reaches;
  expect(reaches.length).toBeGreaterThan(0);
  expect(published.counts.river).toBe(reaches.length);
  if (branching) expect(published.counts.river).toBeGreaterThan(1);
  for (const reach of reaches) {
    expect(reach.coordinates.length).toBeGreaterThan(1);
    expect(reach.discharges).toHaveLength(reach.coordinates.length);
    expect(reach.catchmentAreas).toHaveLength(reach.coordinates.length);
    expect(reach.discharges.every((flow) => Number.isFinite(flow) && flow > 0)).toBe(true);
  }
  expect(published.counts.settlement).toBeGreaterThan(2);
  expect(published.counts.road).toBeGreaterThan(0);
  expect(published.rasterResult.categories.length).toBeGreaterThan(1);
}
async function openWorkload(f: Fixture, child: string) {
  const db = await sqliteFixture(),
    blocks = blockCacheFixture(512 * 1024 * 1024),
    features = new SqliteFeatureWorkspace(db),
    sourceFeatures = new SqliteFeatureWorkspace(db, "source_features"),
    networks = new SqliteNetworkWorkspace(db),
    sourceNetworks = new SqliteNetworkWorkspace(db, "source_networks"),
    source = await generationSource(f.workspace.catalog, f.id, child),
    fields = new WorkspaceFields(f.workspace.catalog, f.workspace.resources, blocks.cache);
  expect(source.world.fields.every((field) => field.areaId === child)).toBe(true);
  await loadGenerationFeatures(
    source,
    f.workspace.catalog,
    sourceFeatures,
    undefined,
    sourceNetworks
  );
  await fields.read(source, {
    scope: source.scope,
    objects: [],
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
    channels: refinementReads(source, child),
  });
  expect(Object.values(source.numerical).every((grid) => grid.scope.areaId === child)).toBe(true);
  return { db, blocks, features, sourceFeatures, networks, sourceNetworks, source, fields };
}
export async function regionalWorkload(f: Fixture, child = f.child, quality = "standard") {
  const { db, blocks, features, sourceFeatures, networks, sourceNetworks, source, fields } =
    await openWorkload(f, child);
  const input: AtlasGenerationInput = {
      areaId: child,
      seed: 73,
      quality,
      domains: ["physical", "magic", "built", "cultural", "political"],
    },
    started = performance.now(),
    phases: Record<string, number> = {};
  let stage = "start",
    changed = started;
  const mark = (next: string) => {
    const now = performance.now();
    phases[stage] = (phases[stage] ?? 0) + now - changed;
    stage = next;
    changed = now;
  };
  const options = {
    cache: blocks.cache,
    features,
    sourceFeatures,
    networks,
    sourceNetworks,
    contours: new SqliteContourWorkspace(db),
    progress(path: string[]) {
      mark(path.join("/"));
    },
  };
  return {
    source,
    input,
    options,
    features,
    async publish(result: CompletedBoundary) {
      mark("publication");
      const generationMs = performance.now() - started,
        id = crypto.randomUUID(),
        output = generationSnapshot(result, input, id, source),
        signature = surfaceSignature(result);
      await publishWorkspaceGeneration(
        f.workspace.catalog,
        f.workspace.resources,
        source,
        output,
        id,
        false,
        [],
        () => {},
        undefined,
        { features, sourceFeatures, networks, sourceNetworks }
      );
      mark("rasters");
      const rasterResult = await firstRaster(f, child, blocks.cache);
      mark("finished");
      return {
        output,
        signature,
        generationMs,
        phases,
        rasterResult,
        samples: result.state.surface.active.length,
        fields: Object.keys(result.state.surface.channels).length,
        counts: featureCounts(features),
        peakBytes: blocks.cache.stats.peakBytes,
      };
    },
    async close() {
      await fields.close();
      blocks.close();
      db.close();
    },
  };
}
export async function assertRegionalPublication(
  { id, root, child, workspace, parent }: Fixture,
  result: CompletedBoundary,
  output: DomainSnapshot,
  source: DomainSnapshot,
  features: import("@atlas/domain").FeatureReader
) {
  expect(output.world.fields.some((field) => field.areaId === child && !field.input)).toBe(true);
  expect(output.world.epochs).toEqual(parent.world.epochs);
  expect(result.state.diagnostics?.filter((d) => d.outcome !== "retained") ?? []).toEqual([]);
  expect(result.state.physical).toBeUndefined();
  expect(result.state.society).toBeUndefined();
  expect(output.world.societies![child].history).toEqual(parent.world.societies![root].history);
  expect([...features.values()].some((f) => f.name === "Known inland core")).toBe(true);
  const event = [...features.values()].find((feature) => feature.kind === "societyEvent")!;
  expect(event).toBeDefined();
  expect(spatial.covers(source.scope.footprint, event.geometry)).toBe(false);
  const exported = workspace.catalog.exportFeatures(id, child, null, 128);
  expect(exported.features.find((feature) => feature.id === event.id)?.geometry).toEqual(
    event.geometry
  );
  const path = `/refined_${crypto.randomUUID()}.sqlite3`;
  workspace.catalog.snapshot(path);
  const restoredDb = reopenSqliteFixture(workspace.db, path),
    reopened = new SpatialCatalog(restoredDb, await GeometryKernel.create());
  try {
    expect(reopened.exportFeatures(id, child, null, 128)).toEqual(exported);
    const reopenedSource = await generationSource(reopened, id, child);
    const restoredFeatures = new SqliteFeatureWorkspace(restoredDb);
    await loadGenerationFeatures(reopenedSource, reopened, restoredFeatures);
    expect(restoredFeatures.get(event.id)?.geometry).toEqual(event.geometry);
    expect(reopenedSource.world.societies![child].history).toEqual(
      parent.world.societies![root].history
    );
  } finally {
    await reopened.close();
  }
}
function surfaceSignature(result: CompletedBoundary) {
  return Object.fromEntries(
    ["elevation", "finalSurface", "treeCover", "riverOrder"].map((name) => {
      let hash = 2166136261;
      for (const value of result.state.surface.channels[name])
        hash = Math.imul(hash ^ Math.round(value * 1000), 16777619);
      return [name, hash >>> 0];
    })
  );
}
function featureCounts(features: SqliteFeatureWorkspace) {
  const counts: Record<string, number> = {};
  for (const feature of features.values()) counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
  return counts;
}
async function firstRaster(f: Fixture, child: string, cache: import("@atlas/domain").BlockCache) {
  const world = await f.workspace.catalog.readEditor(f.id),
    extent = spatial.bounds(world.areas[child].footprint),
    started = performance.now(),
    rasters = await workspaceRasters(f.workspace, f.id, child, extent, 100),
    raster = rasters.find((r) => r.channel === "elevation")!;
  expect(raster.field.scope.areaId).toBe(child);
  expect(raster.surface).toBeDefined();
  expect(spatial.covers(raster.footprint, raster.field.scope.footprint)).toBe(true);
  const geography = await workspaceRasterGeography(f.workspace.catalog, raster.geography),
    loaded = await loadResourceRaster(
      f.workspace.resources,
      raster,
      geography,
      new FieldInputCache(f.workspace.resources, cache)
    );
  try {
    const samples = numericTileSampler(loaded.raster)(extent, 128);
    expect(Array.from(samples).every(Number.isFinite)).toBe(true);
    return {
      milliseconds: performance.now() - started,
      categories: raster.surface!.channels.finalSurface.categories,
      sampled: samples.length,
    };
  } finally {
    loaded.close();
  }
}
export async function siblingRegion(
  f: Fixture,
  name: string,
  footprint?: DomainSnapshot["scope"]["footprint"]
) {
  let world = await f.workspace.catalog.readEditor(f.id);
  const id = crypto.randomUUID(),
    scope = { worldId: f.id, areaId: f.root, spaceId: f.parent.scope.spaceId };
  const command = async (kind: string, data: Record<string, unknown>) => {
    await executeWorkspaceCommand(
      f.workspace.catalog,
      f.workspace.resources,
      {
        scope,
        preview: false,
        command: { operationId: crypto.randomUUID(), expectedVersion: world.version, kind, data },
      },
      f.workspace.working.cache
    );
    world = await f.workspace.catalog.readEditor(f.id);
  };
  const outline =
    footprint ??
    world.views.find((view) => view.id === world.areas[f.child].regionId)!.region!.footprint;
  await command("putView", {
    id,
    name,
    areaId: f.root,
    layers: [],
    region: { parentId: null, footprint: outline },
  });
  await command("createArea", regionRefinementInput(world, id));
  return refinedRegionArea(world, id)!.id;
}

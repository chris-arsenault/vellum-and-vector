import { expect } from "vitest";
import { readFile } from "node:fs/promises";
import { initializeEngine } from "@atlas/engine";
import { runRustGeneration } from "../rustGeneration";
import {
  spatial,
  regionRefinementInput,
  refinedRegionArea,
  type DomainSnapshot,
  type FeatureReader,
} from "@atlas/domain";
import {
  generationSnapshot,
  refinementReads,
  refineRegionalMap,
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
import { generationSource } from "@atlas/application";
import { loadGenerationFeatures } from "@atlas/application";
import { WorkspaceFields } from "@atlas/application";
import { publishWorkspaceGeneration } from "../generationPublication";
import { workspaceRasters } from "../workspaceRasters";
import { workspaceRasterGeography } from "../workspaceRasterGeography";
import { loadResourceRaster } from "../resourceRaster";
import { numericTileSampler } from "../numericTiles";
import { executeWorkspaceCommand } from "../workspaceCommands";
import type { refinementFixture } from "./regionalRefinementFixture";
import { nativeWorldGeneration } from "../../scripts/nativeWorldGeneration";

type Fixture = Awaited<ReturnType<typeof refinementFixture>>;
export type RegionalWorkloadOutput = Awaited<
  ReturnType<Awaited<ReturnType<typeof regionalWorkload>>["publish"]>
>;

export function assertWorkloadDetail(
  result: Pick<CompletedBoundary, "state">,
  published: RegionalWorkloadOutput,
  branching = true
) {
  expect(result.state.physical).toBeUndefined();
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
  const work = await openWorkload(f, child),
    { db, blocks, features, source, fields } = work;
  const input: AtlasGenerationInput = {
      areaId: child,
      seed: 73,
      quality,
      domains: ["physical", "magic", "built", "cultural", "political"],
    },
    { started, phases, mark } = phaseTimer();
  let native:
    Awaited<ReturnType<typeof nativeWorldGeneration | typeof runRustGeneration>> | undefined;
  const options = workloadOptions(work, mark);
  return {
    source,
    input,
    options,
    get features() {
      return native?.state.features ?? features;
    },
    async generate() {
      if (!["rust", "wasm"].includes(process.env.ATLAS_ENGINE ?? ""))
        return refineRegionalMap(source, input, options);
      native = await portedGeneration(f, work, input, options);
      return native;
    },
    async publish(result: Pick<CompletedBoundary, "state">) {
      mark("publication");
      const generationMs = performance.now() - started,
        id = native?.operationId ?? crypto.randomUUID(),
        output = generationSnapshot(result, input, id, source);
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
        { ...result.state, ready: native?.ready }
      );
      mark("rasters");
      const rasterResult = await firstRaster(f, child, blocks.cache);
      mark("finished");
      return {
        output,
        generationMs,
        phases,
        rasterResult,
        samples: result.state.surface.active.length,
        fields: Object.keys(result.state.surface.channels).length,
        counts: featureCounts(result.state.features!),
        peakBytes: blocks.cache.stats.peakBytes,
      };
    },
    async close() {
      await native?.close();
      await fields.close();
      blocks.close();
      db.close();
    },
  };
}
function portedGeneration(
  f: Fixture,
  work: Awaited<ReturnType<typeof openWorkload>>,
  input: AtlasGenerationInput,
  options: ReturnType<typeof workloadOptions>
) {
  if (process.env.ATLAS_ENGINE === "wasm") return wasmGeneration(f, work, input, options);
  return nativeWorldGeneration(
    work.source,
    input,
    ".artifacts/regional",
    work.blocks.cache,
    options,
    {
      directory: f.workspace.files.directory,
      features: work.sourceFeatures,
      networks: work.sourceNetworks,
    }
  );
}
/** Run the same WASM adapter with the existing filesystem fixture in the Node workload. */
async function wasmGeneration(
  f: Fixture,
  work: Awaited<ReturnType<typeof openWorkload>>,
  input: AtlasGenerationInput,
  options: ReturnType<typeof workloadOptions>
) {
  await initializeEngine(
    await readFile(new URL("../../../packages/engine/dist/atlas_host_bg.wasm", import.meta.url))
  );
  const kernel = await GeometryKernel.create();
  try {
    return await runRustGeneration(
      work.source,
      input,
      crypto.randomUUID(),
      f.workspace.files.store,
      {
        ...work,
        kernel,
        store: f.workspace.resources,
        cancelled: () => false,
        send() {},
      },
      options,
      async () => {
        const scratch = blockCacheFixture();
        return {
          access: scratch.access,
          async close() {
            scratch.close();
          },
        };
      }
    );
  } finally {
    kernel.close();
  }
}
function workloadOptions(
  work: Awaited<ReturnType<typeof openWorkload>>,
  mark: (stage: string) => void
) {
  return {
    cache: work.blocks.cache,
    features: work.features,
    sourceFeatures: work.sourceFeatures,
    networks: work.networks,
    sourceNetworks: work.sourceNetworks,
    contours: new SqliteContourWorkspace(work.db),
    progress(path: string[]) {
      mark(path.join("/"));
    },
  };
}
function phaseTimer() {
  const started = performance.now(),
    phases: Record<string, number> = {};
  let stage = "start",
    changed = started;
  return {
    started,
    phases,
    mark(next: string) {
      const now = performance.now();
      phases[stage] = (phases[stage] ?? 0) + now - changed;
      stage = next;
      changed = now;
    },
  };
}
export async function assertRegionalPublication(
  { id, child, workspace, parent }: Fixture,
  result: Pick<CompletedBoundary, "state">,
  output: DomainSnapshot,
  source: DomainSnapshot,
  features: import("@atlas/domain").FeatureReader
) {
  expect(output.world.fields.some((field) => field.areaId === child && !field.input)).toBe(true);
  expect(output.world.epochs).toEqual(parent.world.epochs);
  expect(result.state.diagnostics?.filter((d) => d.outcome !== "retained") ?? []).toEqual([]);
  expect(result.state.physical).toBeUndefined();
  expect([...features.values()].some((f) => f.name === "Known inland core")).toBe(true);
  const capturedEvent = [...result.state.sourceFeatures!.values()].find(
      (feature) => feature.kind === "societyEvent" && feature.attributes.era === "Earlier era"
    )!,
    event = features.get(capturedEvent.id)!;
  expect(event).toBeDefined();
  expect(event.geometry).toEqual(capturedEvent.geometry);
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
  } finally {
    await reopened.close();
  }
}
function featureCounts(features: FeatureReader) {
  const counts: Record<string, number> = {};
  for (const feature of features.values()) counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
  return counts;
}
async function firstRaster(f: Fixture, child: string, cache: import("@atlas/domain").BlockCache) {
  const world = await f.workspace.catalog.readEditor(f.id),
    extent = spatial.bounds(world.areas[child].footprint),
    started = performance.now(),
    rasters = await workspaceRasters(f.workspace, f.id, child, extent, 100),
    raster = rasters.find((r) => r.channel === "Elevation")!;
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
      categories: raster.surface!.channels.finalSurface!.categories,
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

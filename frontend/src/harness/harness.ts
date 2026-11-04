import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newGenerationDraft } from "../generationDraft";
import { rasterOverview, rasterRelief } from "../testSupport/regionalOverview";
import { generateWorld, refineRegion } from "./harnessGeneration";
import {
  checkpointDirectory,
  copyCheckpoint,
  currentCommit,
  harnessRoot,
  openHarnessWorkspace,
  readCheckpoint,
  removeCheckpoint,
  type CheckpointRecord,
} from "./harnessWorkspace";
import { stageRecorder } from "./stageRecord";
import { channelRanges, fieldInventory, openTerrain, scaleReport, tileTiming } from "./mapReport";
import { featureReport, mapFeatures } from "./featureReport";

/** What one harness run does; read from the environment of `pnpm harness`. */
export interface HarnessOptions {
  world: string;
  worldQuality: string;
  region: string;
  regionQuality: string;
  /** Map metres of the point whose subdivision becomes the region. */
  regionAt?: [number, number];
  /** Checkpoints to make again rather than reuse; a new world also makes a new region. */
  fresh: Set<string>;
}
/** Defaults: the app's default world at standard quality and its standard region. */
const defaults = {
  HARNESS_WORLD: "world",
  HARNESS_WORLD_QUALITY: "standard",
  HARNESS_REGION: "region",
  HARNESS_REGION_QUALITY: "standard",
  HARNESS_FRESH: "",
  HARNESS_REGION_AT: "",
};
function position(text: string): [number, number] | undefined {
  const at = text.split(",").map(Number);
  return at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : undefined;
}
export function harnessOptions(env: Record<string, string | undefined>): HarnessOptions {
  const read = (key: keyof typeof defaults) => env[key] || defaults[key];
  const fresh = new Set(read("HARNESS_FRESH").split(",").filter(Boolean));
  if (fresh.has("world")) fresh.add("region");
  return {
    world: read("HARNESS_WORLD"),
    worldQuality: read("HARNESS_WORLD_QUALITY"),
    region: read("HARNESS_REGION"),
    regionQuality: read("HARNESS_REGION_QUALITY"),
    regionAt: position(read("HARNESS_REGION_AT")),
    fresh,
  };
}

const write = (directory: string, name: string, value: unknown) =>
  writeFileSync(join(directory, `${name}.json`), JSON.stringify(value, null, 2));

/** A real generated world from the app's default draft, at the chosen quality. */
async function ensureWorld(options: HarnessOptions, out: string): Promise<CheckpointRecord> {
  const reused = !options.fresh.has("world") && readCheckpoint(options.world);
  if (reused) return reused;
  removeCheckpoint(options.world);
  const ws = await openHarnessWorkspace(checkpointDirectory(options.world)),
    recorder = stageRecorder(),
    draft = newGenerationDraft(),
    started = performance.now();
  draft.recipe.quality = options.worldQuality as typeof draft.recipe.quality;
  try {
    const { worldId, root } = await generateWorld(ws, draft, recorder.observers);
    const record: CheckpointRecord = {
      kind: "world",
      name: options.world,
      worldId,
      root,
      seed: draft.recipe.seed,
      quality: options.worldQuality,
      width: draft.width,
      height: draft.height,
      position: recorder.highestLand(),
      commit: currentCommit(),
      createdAt: new Date().toISOString(),
    };
    await ws.save(record);
    write(out, "world-run", { ...recorder, seconds: (performance.now() - started) / 1000 });
    return record;
  } finally {
    await ws.close();
  }
}

/** The region under a point of the world, refined from a copy of the world's checkpoint. */
async function ensureRegion(options: HarnessOptions, world: CheckpointRecord, out: string) {
  const reused = !options.fresh.has("region") && readCheckpoint(options.region);
  if (reused && reused.world === world.name) return reused;
  copyCheckpoint(world.name, options.region);
  const ws = await openHarnessWorkspace(checkpointDirectory(options.region)),
    recorder = stageRecorder(),
    at = options.regionAt ?? world.position,
    started = performance.now();
  if (!at) throw new Error("Give HARNESS_REGION_AT=x,y: the world records no highest land.");
  try {
    const { child } = await refineRegion(
      ws,
      world.worldId,
      { x: at[0], y: at[1], z: 0 },
      options.regionQuality,
      recorder.observers
    );
    const record: CheckpointRecord = {
      ...world,
      kind: "region",
      name: options.region,
      world: world.name,
      child,
      quality: options.regionQuality,
      position: at,
      commit: currentCommit(),
      createdAt: new Date().toISOString(),
    };
    await ws.save(record);
    write(out, "region-run", { ...recorder, seconds: (performance.now() - started) / 1000 });
    return record;
  } finally {
    await ws.close();
  }
}

/** The map's record: scale, fields and layers, channel ranges, features, tiles and images. */
async function describeMap(record: CheckpointRecord, out: string) {
  const ws = await openHarnessWorkspace(checkpointDirectory(record.name)),
    areaId = record.child ?? record.root;
  try {
    const terrain = await openTerrain(ws, record.worldId, areaId);
    try {
      const features = await mapFeatures(ws, record.worldId, areaId),
        grid = terrain.raster.field;
      write(out, record.kind, {
        checkpoint: record,
        scale: scaleReport(terrain.world, areaId, record.quality, grid),
        fields: fieldInventory(terrain.world, areaId, terrain.rasters),
        features: featureReport(features, {
          ocean: terrain.geography.ocean,
          lakes: terrain.geography.lakes,
          footprint: terrain.world.areas[areaId].footprint,
          cellSpan: Number(grid.scope.resolution),
        }),
        tiles: await tileTiming(ws, terrain),
      });
      write(out, `${record.kind}-channels`, await channelRanges(ws, terrain.world, areaId));
      await rasterOverview(terrain.raster, features, `${record.kind}-overview`, out);
      await rasterRelief(terrain.raster, `${record.kind}-relief`, out);
    } finally {
      terrain.close();
    }
  } finally {
    await ws.close();
  }
}

/**
 * Makes or reuses the world and region checkpoints, then records both maps. Output goes to
 * a fresh directory under `.artifacts/harness/reports`; the path is returned.
 */
export async function runHarness(options: HarnessOptions) {
  const out = join(harnessRoot, "reports", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  const world = await ensureWorld(options, out),
    region = await ensureRegion(options, world, out);
  await describeMap(world, out);
  await describeMap(region, out);
  return out;
}

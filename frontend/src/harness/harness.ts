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
import { quickTerrain } from "./quickTerrain";
import { stageRecorder } from "./stageRecord";
import { channelRanges, fieldInventory, openTerrain, scaleReport, tileTiming } from "./mapReport";
import { featureReport, mapFeatures } from "./featureReport";
import { reliefReport } from "./reliefReport";
import { traceRelief } from "./reliefTrace";

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
  /** Only the saved world's region's ground and water, and a picture of them. */
  quick: boolean;
  /** Only the world: its structure is judged before anything is refined from it. */
  worldOnly: boolean;
  /** Saves the world's state at the start of each pass under this name, for `stageReplay`. */
  snapshots: string;
}
/** The world the harness judges, so a result is not fitted to the app's default seed. */
const harnessSeed = 271_828;
/** Defaults: the app's default world at standard quality and its standard region. */
const defaults = {
  HARNESS_WORLD: "world",
  HARNESS_WORLD_QUALITY: "standard",
  HARNESS_REGION: "region",
  HARNESS_REGION_QUALITY: "standard",
  HARNESS_FRESH: "",
  HARNESS_REGION_AT: "",
  HARNESS_QUICK: "",
  HARNESS_WORLD_ONLY: "",
  HARNESS_SNAPSHOTS: "",
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
    quick: Boolean(read("HARNESS_QUICK")),
    worldOnly: Boolean(read("HARNESS_WORLD_ONLY")),
    snapshots: read("HARNESS_SNAPSHOTS"),
  };
}

const write = (directory: string, name: string, value: unknown) =>
  writeFileSync(join(directory, `${name}.json`), JSON.stringify(value, null, 2));

/** A failed step does not stop a run, it skips what depends on it: say so where it will be seen. */
function sayFailures(map: string, diagnostics: { severity: string; message: string }[]) {
  for (const { severity, message } of diagnostics)
    if (severity === "error") process.stdout.write(`\n${map} step failed: ${message}\n`);
}

/** A real generated world from the app's default draft, at the chosen quality. */
async function ensureWorld(options: HarnessOptions, out: string): Promise<CheckpointRecord> {
  const reused = !options.fresh.has("world") && readCheckpoint(options.world);
  if (reused) return reused;
  removeCheckpoint(options.world);
  const ws = await openHarnessWorkspace(checkpointDirectory(options.world)),
    recorder = stageRecorder(),
    draft = newGenerationDraft(),
    started = performance.now(),
    stopTrace = traceRelief(
      options.snapshots ? { label: options.snapshots, quality: options.worldQuality } : undefined
    );
  draft.recipe.quality = options.worldQuality as typeof draft.recipe.quality;
  draft.recipe.seed = harnessSeed;
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
    const { steps, probes, columns, rock } = stopTrace();
    write(out, "world-trace", steps);
    write(out, "world-probes", probes);
    write(out, "world-columns", columns);
    write(out, "world-rock", rock);
    sayFailures("world", recorder.diagnostics);
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
    sayFailures("region", recorder.diagnostics);
    return record;
  } finally {
    await ws.close();
  }
}

/**
 * The saved world's region, ground and water only, stopped as soon as they are settled. It
 * leaves out the living landscape, magic, society, publishing and the full report, and it
 * writes a picture and the ground's numbers. For judging the terrain in about a minute.
 */
async function quickRegion(options: HarnessOptions, out: string) {
  const world = readCheckpoint(options.world);
  if (!world) throw new Error(`No saved world named ${options.world}.`);
  const at = options.regionAt ?? world.position;
  if (!at) throw new Error("Give HARNESS_REGION_AT=x,y: the world records no highest land.");
  copyCheckpoint(world.name, quickCheckpoint);
  const ws = await openHarnessWorkspace(checkpointDirectory(quickCheckpoint)),
    started = performance.now();
  let done = false;
  const observers = {
    inspect(_path: string[], process: string, state: Parameters<typeof quickTerrain>[0]) {
      const seconds = () => Math.round((performance.now() - started) / 1000);
      if (process.endsWith("/structure"))
        process_report(
          quickTerrain(state, out, process.split(".")[1].replace("/", "-")),
          seconds()
        );
      if (process !== quickUntil) return;
      process_report(quickTerrain(state, out), seconds());
      done = true;
    },
    stop: () => done,
  };
  try {
    await refineRegion(
      ws,
      world.worldId,
      { x: at[0], y: at[1], z: 0 },
      options.regionQuality,
      observers,
      ["physical"]
    );
  } catch (error) {
    if (!done) throw error;
  } finally {
    await ws.close();
  }
}
const quickCheckpoint = "quick-region",
  quickUntil = "refinement.refresh";
const process_report = (report: object, seconds: number) =>
  process.stdout.write(`\n${seconds} s ${JSON.stringify(report)}\n`);

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
      write(
        out,
        `${record.kind}-relief`,
        await reliefReport(ws, terrain.world, areaId, { out, kind: record.kind })
      );
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
  if (options.quick) {
    await quickRegion(options, out);
    return out;
  }
  const world = await ensureWorld(options, out);
  await describeMap(world, out);
  if (!options.worldOnly) await describeMap(await ensureRegion(options, world, out), out);
  return out;
}

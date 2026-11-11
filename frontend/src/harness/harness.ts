import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newGenerationDraft, normalizeGenerationDraft } from "../generationDraft";
import { write } from "./harnessWrite";
import { recordResumePoints } from "./resumePoint";
import { resumeWorld } from "./harnessResume";
import { applyCartographicChoice, cartographicControls } from "../cartographicDraft";
import {
  generationRecipeSchema,
  generationEpochSchema,
  type GenerationRecipe,
} from "@atlas/generation";
import type { Epoch } from "@atlas/domain";
import { replaceDraftEpochs } from "../generationDraftEpochs";
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
import { processProbeBands, startProcessProbe } from "./processProbe";
import { groundProbeCells } from "./groundProbe";
import { startCpuProfile } from "./cpuProfile";
import { recordMagicInspection, recordFieldInspection } from "./magicInspection";
import type { PhysicalBufferName } from "../../../packages/generation/src/world/field";

/** What one harness run does; read from the environment of `pnpm harness`. */
export interface HarnessOptions {
  seed: number;
  world: string;
  worldQuality: string;
  /** Optional curated terrain choice, applied through the same operation as setup. */
  terrain: string;
  /** An ordinary current GenerationDraft JSON file, normalized through the app's bindings. */
  draftPath: string;
  /** Optional ordinary domain selection for geography-only inspection. */
  domains?: GenerationRecipe["domains"];
  /** Explicit ordinary epoch settings for continued-history semantic workloads. */
  epochs?: Epoch[];
  /** Optional ordinary world dimensions in metres; cell span still follows quality. */
  worldSize?: [number, number];
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
  /** Saves the whole run's state as each epoch completes under this name, for `resume`. */
  resumePoints: string;
  /** Continues the named saved run after `resumeAfter` instead of generating a world. */
  resume: string;
  /** The completed epoch to continue after: its ancestry ids joined by "/". */
  resumeAfter: string;
  /** Stops a continued run after this many seconds, so its first minutes can be profiled. */
  stopSeconds: number;
  /** Optional map coordinate sampled before/after each process and settlement. */
  processAt?: [number, number];
  processBands?: readonly PhysicalBufferName[];
  groundCells?: readonly number[];
  /** Capture a V8 CPU profile for the complete harness invocation. */
  cpuProfile: boolean;
  /** Explicit POI catalogue audit; ordinary geography runs do not exercise every place rule. */
  places: boolean;
}
/** The world the harness judges, so a result is not fitted to the app's default seed. */
const harnessSeed = 271_828;
/** Defaults: the app's default world at standard quality and its standard region. */
const defaults = {
  HARNESS_WORLD: "world",
  HARNESS_WORLD_QUALITY: "standard",
  HARNESS_TERRAIN: "",
  HARNESS_DRAFT: "",
  HARNESS_DOMAINS: "",
  HARNESS_EPOCHS: "",
  HARNESS_WORLD_SIZE: "",
  HARNESS_REGION: "region",
  HARNESS_REGION_QUALITY: "standard",
  HARNESS_FRESH: "",
  HARNESS_REGION_AT: "",
  HARNESS_QUICK: "",
  HARNESS_WORLD_ONLY: "",
  HARNESS_SNAPSHOTS: "",
  HARNESS_RESUME_POINTS: "",
  HARNESS_RESUME: "",
  HARNESS_AFTER: "",
  HARNESS_STOP_SECONDS: "",
  HARNESS_PROCESS_AT: "",
  HARNESS_PROCESS_BANDS: "",
  HARNESS_GROUND_CELLS: "",
  HARNESS_SEED: String(harnessSeed),
  HARNESS_CPU_PROFILE: "",
  HARNESS_PLACES: "",
};
function position(text: string): [number, number] | undefined {
  const at = text.split(",").map(Number);
  return at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : undefined;
}
export function harnessOptions(env: Record<string, string | undefined>): HarnessOptions {
  const read = (key: keyof typeof defaults) => env[key] || defaults[key];
  const fresh = new Set(read("HARNESS_FRESH").split(",").filter(Boolean));
  const size = read("HARNESS_WORLD_SIZE"),
    worldSize = position(size);
  if (size && (!worldSize || worldSize.some((value) => value <= 0)))
    throw new Error("HARNESS_WORLD_SIZE requires positive width,height in metres.");
  if (fresh.has("world")) fresh.add("region");
  return {
    seed: Number(read("HARNESS_SEED")),
    world: read("HARNESS_WORLD"),
    worldQuality: read("HARNESS_WORLD_QUALITY"),
    terrain: read("HARNESS_TERRAIN"),
    draftPath: read("HARNESS_DRAFT"),
    epochs: read("HARNESS_EPOCHS")
      ? generationEpochSchema
          .array()
          .min(1)
          .parse(JSON.parse(read("HARNESS_EPOCHS")))
      : undefined,
    domains: read("HARNESS_DOMAINS")
      ? generationRecipeSchema.shape.domains.parse(read("HARNESS_DOMAINS").split(","))
      : undefined,
    worldSize,
    region: read("HARNESS_REGION"),
    regionQuality: read("HARNESS_REGION_QUALITY"),
    regionAt: position(read("HARNESS_REGION_AT")),
    fresh,
    quick: Boolean(read("HARNESS_QUICK")),
    worldOnly: Boolean(read("HARNESS_WORLD_ONLY")),
    snapshots: read("HARNESS_SNAPSHOTS"),
    resumePoints: read("HARNESS_RESUME_POINTS"),
    resume: read("HARNESS_RESUME"),
    resumeAfter: read("HARNESS_AFTER"),
    stopSeconds: Number(read("HARNESS_STOP_SECONDS")) || 0,
    processAt: position(read("HARNESS_PROCESS_AT")),
    processBands: processProbeBands(read("HARNESS_PROCESS_BANDS")),
    groundCells: groundProbeCells(read("HARNESS_GROUND_CELLS")),
    cpuProfile: Boolean(read("HARNESS_CPU_PROFILE")),
    places: Boolean(read("HARNESS_PLACES")),
  };
}

export { write };

const recordProcesses = (options: HarnessOptions, out: string, map: string) =>
  startProcessProbe(
    options.processAt,
    options.processBands,
    (samples) => write(out, `${map}-processes`, samples),
    { cells: options.groundCells ?? [], publish: (samples) => write(out, `${map}-ground`, samples) }
  );

/** Persist boundaries immediately, including when a process later crashes. */
function liveRecorder(out: string, map: string, places: boolean) {
  const recorder = stageRecorder((event) => {
    appendFileSync(join(out, `${map}-progress.jsonl`), `${JSON.stringify(event)}\n`);
    if (event.kind === "start" || event.kind === "diagnostic")
      process.stdout.write(`${JSON.stringify(event)}\n`);
  }, places);
  recordMagicInspection(recorder.observers, out, map);
  recordFieldInspection(recorder.observers, out, map);
  return recorder;
}

function saveTrace(out: string, stop: ReturnType<typeof traceRelief>, failure?: string) {
  const trace = stop(failure);
  for (const [key, value] of Object.entries(trace))
    if (value !== undefined) write(out, `world-${key === "steps" ? "trace" : key}`, value);
}

function worldDraft(options: HarnessOptions) {
  let draft = options.draftPath
    ? normalizeGenerationDraft(JSON.parse(readFileSync(options.draftPath, "utf8")))
    : newGenerationDraft();
  if (options.epochs) draft = normalizeGenerationDraft(replaceDraftEpochs(draft, options.epochs));
  if (options.domains) draft.recipe.domains = options.domains;
  if (!options.terrain) return draft;
  const terrain = cartographicControls().find((control) => control.id === "terrain")!;
  return applyCartographicChoice(draft, terrain, options.terrain);
}

/** A real generated world from the app's default draft, at the chosen quality. */
async function ensureWorld(options: HarnessOptions, out: string): Promise<CheckpointRecord> {
  const reused = !options.fresh.has("world") && readCheckpoint(options.world);
  if (reused) return reused;
  removeCheckpoint(options.world);
  const ws = await openHarnessWorkspace(checkpointDirectory(options.world)),
    recorder = liveRecorder(out, "world", options.places),
    draft = worldDraft(options),
    started = performance.now(),
    stopTrace = traceRelief(
      options.snapshots
        ? {
            label: options.snapshots,
            quality: options.worldQuality,
            seed: options.seed,
            epochs: draft.recipe.settings.epochs,
          }
        : undefined
    ),
    stopProcesses = recordProcesses(options, out, "world");
  draft.recipe.quality = options.worldQuality as typeof draft.recipe.quality;
  draft.recipe.seed = options.seed;
  if (options.worldSize) [draft.width, draft.height] = options.worldSize;
  write(out, "world-input", { draft, options: { ...options, fresh: [...options.fresh] } });
  let failure: string | undefined;
  try {
    const snapshot = recordResumePoints(options.resumePoints, draft, recorder.observers);
    const { worldId, root } = await generateWorld(ws, draft, recorder.observers, snapshot);
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
    return record;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      write(out, "world-run", {
        ...recorder,
        seconds: (performance.now() - started) / 1000,
        memory: process.memoryUsage(),
        resourceUsage: process.resourceUsage(),
      });
      stopProcesses();
    } finally {
      try {
        saveTrace(out, stopTrace, failure);
      } finally {
        await ws.close();
      }
    }
  }
}

/** The region under a point of the world, refined from a copy of the world's checkpoint. */
async function ensureRegion(options: HarnessOptions, world: CheckpointRecord, out: string) {
  const reused = !options.fresh.has("region") && readCheckpoint(options.region);
  if (reused && reused.world === world.name) return reused;
  const at = options.regionAt ?? world.position;
  if (!at) throw new Error("Give HARNESS_REGION_AT=x,y: the world records no highest land.");
  copyCheckpoint(world.name, options.region);
  const ws = await openHarnessWorkspace(checkpointDirectory(options.region)),
    recorder = liveRecorder(out, "region", options.places),
    started = performance.now(),
    stopProcesses = recordProcesses(options, out, "region");
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
    try {
      stopProcesses();
    } finally {
      await ws.close();
    }
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
    started = performance.now(),
    stopProcesses = recordProcesses(options, out, "quick-region");
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
    try {
      stopProcesses();
    } finally {
      await ws.close();
    }
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
      const view = { extent: terrain.extent, reference: terrain.world.reference };
      await rasterOverview(terrain.raster, features, `${record.kind}-overview`, out, view);
      await rasterRelief(terrain.raster, `${record.kind}-relief`, out, view);
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
  process.stdout.write(`Harness report: ${out}\n`);
  write(out, "invocation", {
    ...options,
    fresh: [...options.fresh],
    commit: currentCommit(),
    pid: process.pid,
  });
  const stopProfile = await startCpuProfile(join(out, "run.cpuprofile"), options.cpuProfile);
  try {
    if (options.quick) {
      await quickRegion(options, out);
      return out;
    }
    if (options.resume) {
      const recorder = liveRecorder(out, "world", options.places);
      await describeMap(await resumeWorld({ options, out, recorder, write }), out);
      return out;
    }
    const world = await ensureWorld(options, out);
    await describeMap(world, out);
    if (!options.worldOnly) await describeMap(await ensureRegion(options, world, out), out);
    return out;
  } catch (error) {
    write(out, "failure", {
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      memory: process.memoryUsage(),
      resourceUsage: process.resourceUsage(),
    });
    throw error;
  } finally {
    await stopProfile();
  }
}

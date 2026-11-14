import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import {
  Band,
  requireThat,
  writeRange,
  type AtlasFeature,
  type Coverage,
  type DomainSnapshot,
} from "@atlas/domain";
import type { CompletedBoundary, GenerationState } from "../../../packages/generation/src/process";
import type { MapRunnerOptions } from "../../../packages/generation/src/mapRunner";
import { restoreRunMemories, runMemories } from "../../../packages/generation/src/runMemory";
import { draftWorldSnapshot, type GenerationDraft } from "../generationDraft";
import {
  captureFieldState,
  latticeRecord,
  restoreFieldState,
  restoreLand,
  type FieldState,
  type LatticeRecord,
} from "./fieldSnapshot";
import { currentCommit, harnessRoot } from "./harnessWorkspace";

/**
 * A world as it stood when an epoch completed, saved so later work continues the same
 * generation from there instead of making its geology again: the land, its magic and
 * landmarks, and what the run had recorded. One run with `HARNESS_RESUME_POINTS=<label>`
 * writes one per completed epoch; `HARNESS_RESUME=<label> HARNESS_AFTER=<epoch id>` continues
 * from one.
 */
const resumeRoot = join(harnessRoot, "resume");
/** The parts of the world record that generation writes as it runs. */
const generatedRecords = [
  "entities",
  "landmarks",
  "magic",
  "drainage",
  "connections",
  "networkNodes",
  "networkReaches",
] as const;
const bandMark = "__band",
  keptMark = "__kept";
interface SavedBand {
  [bandMark]: { type: Band["type"]; name: string; values: ArrayLike<number> };
}
/** What made the world: the same installed map and request continue it. */
export interface ResumeSource {
  draft: GenerationDraft;
  snapshot: DomainSnapshot;
  commit: string;
  createdAt: string;
}
export interface ResumePoint {
  format: 2;
  /** What rebuilds the land's lattice, so the land can be opened without running anything. */
  lattice: LatticeRecord;
  /** The completed epoch's ancestry ids, outermost first. */
  after: string[];
  field: FieldState;
  /** Magic, landmarks and other state the physical workspace holds beside the land. */
  workspace: unknown;
  /** The surface channels last projected from the land, with their units. */
  surface: unknown;
  run: {
    history: GenerationState["history"];
    causes: GenerationState["causes"];
    facts: string[];
    /** What processes remember from one epoch to the next beside the fields. */
    memory: ReadonlyMap<string, unknown>;
    /** What generation had added to the world record: places, sources, drainage, named things. */
    world: Pick<DomainSnapshot["world"], (typeof generatedRecords)[number]>;
    retainedFeatureNames: GenerationState["retainedFeatureNames"];
    features: AtlasFeature[];
  };
}
const isSavedBand = (value: unknown): value is SavedBand =>
  typeof value === "object" && value !== null && bandMark in value;
const isKept = (value: unknown) => typeof value === "object" && value !== null && keptMark in value;
const isPlain = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** A copy with every band as its values and every object the run rebuilds left as a marker. */
export function detach(value: unknown, path: Set<object> = new Set()): unknown {
  if (value instanceof Band)
    return { [bandMark]: { type: value.type, name: value.name, values: value.toArray() } };
  if (typeof value === "function") return undefined;
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  requireThat(!path.has(value), "resume_cycle", "Resume state must not hold a cycle.");
  path.add(value);
  try {
    return detachContainer(value, path);
  } finally {
    path.delete(value);
  }
}
function detachContainer(value: object, path: Set<object>): unknown {
  if (Array.isArray(value)) return value.map((item) => detach(item, path));
  if (value instanceof Set) return new Set([...value].map((item) => detach(item, path)));
  if (value instanceof Map)
    return new Map([...value].map(([key, item]) => [key, detach(item, path)]));
  if (!isPlain(value)) return { [keptMark]: true };
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "function" ? [] : [[key, detach(item, path)]]
    )
  );
}
function reviveBand(existing: unknown, saved: SavedBand, coverage: Coverage) {
  const { type, name, values } = saved[bandMark];
  const band =
    existing instanceof Band && existing.length === values.length
      ? existing
      : coverage.scratch(type, name, values.length);
  if (band !== existing) band.retain();
  writeRange(band, 0, values);
  return band;
}
/** The saved value put back, reusing the bands and containers the initializers already made. */
export function revive(existing: unknown, saved: unknown, coverage: Coverage): unknown {
  if (isSavedBand(saved)) return reviveBand(existing, saved, coverage);
  if (isKept(saved)) return existing;
  if (saved === null || typeof saved !== "object" || ArrayBuffer.isView(saved)) return saved;
  return reviveContainer(existing, saved, coverage);
}
function reviveContainer(existing: unknown, saved: object, coverage: Coverage): unknown {
  if (Array.isArray(saved)) return reviveArray(existing, saved, coverage);
  if (saved instanceof Set)
    return new Set([...saved].map((item) => revive(undefined, item, coverage)));
  if (saved instanceof Map) return reviveMap(existing, saved, coverage);
  const reusable = typeof existing === "object" && existing !== null && !Array.isArray(existing),
    target = (reusable ? existing : {}) as Record<string, unknown>;
  for (const [key, item] of Object.entries(saved))
    target[key] = revive(target[key], item, coverage);
  return target;
}
function reviveArray(existing: unknown, saved: unknown[], coverage: Coverage) {
  const target = Array.isArray(existing) ? existing : [];
  target.length = saved.length;
  saved.forEach((item, index) => (target[index] = revive(target[index], item, coverage)));
  return target;
}
function reviveMap(existing: unknown, saved: Map<unknown, unknown>, coverage: Coverage) {
  const previous = existing instanceof Map ? existing : new Map();
  return new Map([...saved].map(([key, item]) => [key, revive(previous.get(key), item, coverage)]));
}

export function captureResumePoint(boundary: CompletedBoundary): ResumePoint {
  const state = boundary.state,
    work = state.physical;
  requireThat(work, "resume_state", "A resume point needs the physical workspace.");
  return {
    format: 2,
    lattice: latticeRecord(work.map, work.profile),
    after: boundary.ancestry.map((epoch) => epoch.id),
    field: captureFieldState(work.map),
    workspace: detach({
      magic: work.magic,
      landmarks: work.landmarks,
      landmarkRoster: work.landmarkRoster,
      lakeOutlines: work.lakeOutlines,
    }),
    surface: detach({
      channels: state.surface.channels,
      units: state.surface.units,
      quantities: state.surface.quantities,
    }),
    run: {
      history: structuredClone(state.history),
      causes: structuredClone(state.causes),
      facts: [...state.facts],
      memory: structuredClone(new Map(runMemories(state))),
      world: structuredClone(
        Object.fromEntries(generatedRecords.map((key) => [key, state.domain.world[key]]))
      ) as ResumePoint["run"]["world"],
      retainedFeatureNames: structuredClone(state.retainedFeatureNames),
      features: state.features ? [...state.features.values()] : [],
    },
  };
}
export function restoreResumePoint(state: GenerationState, point: ResumePoint) {
  const work = state.physical;
  requireThat(work, "resume_state", "Initializers must build the physical workspace first.");
  restoreFieldState(work.map, point.field);
  revive(work, point.workspace, work.map.coverage);
  state.history = point.run.history;
  state.causes = point.run.causes;
  // The saved facts replace the replayed ones in place: the ledger holds this same set.
  state.facts.clear();
  for (const fact of point.run.facts) state.facts.add(fact);
  restoreRunMemories(state, point.run.memory);
  revive(state.surface, point.surface, state.surface.coverage);
  Object.assign(state.domain.world, point.run.world);
  state.retainedFeatureNames = point.run.retainedFeatureNames;
  for (const feature of point.run.features) state.features?.put(feature);
}

const pointPath = (label: string, after: readonly string[]) =>
  join(resumeRoot, label, `after-${after.join("--").replace(/[^\w.-]+/g, "_")}.bin`);
const sourcePath = (label: string) => join(resumeRoot, label, "source.bin");

/**
 * Under a label, records the world a draft installs and then one resume point as each epoch
 * completes, through the run's boundary observer, and returns that world for the run to use.
 * Without a label nothing is recorded and the run installs its own.
 */
export function recordResumePoints(
  label: string,
  draft: GenerationDraft,
  observers: Pick<MapRunnerOptions, "boundary">
) {
  if (!label) return undefined;
  const snapshot = draftWorldSnapshot(draft);
  mkdirSync(join(resumeRoot, label), { recursive: true });
  const source: ResumeSource = {
    draft,
    snapshot: structuredClone(snapshot),
    commit: currentCommit(),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(sourcePath(label), serialize(source));
  observers.boundary = (boundary) => {
    if (boundary.kind !== "epoch" || !boundary.state.physical) return;
    const point = captureResumePoint(boundary);
    writeFileSync(pointPath(label, point.after), serialize(point));
  };
  return snapshot;
}
export function readResumeSource(label: string): ResumeSource {
  return deserialize(readFileSync(sourcePath(label))) as ResumeSource;
}
/** The runner option that continues a run after the named completed epoch. */
export function resumeFrom(
  label: string,
  after: string[]
): NonNullable<MapRunnerOptions["resume"]> {
  const point = readResumePoint(label, after);
  return { after: point.after, restore: (state) => restoreResumePoint(state, point) };
}
function readResumePoint(label: string, after: string[]) {
  const point = deserialize(readFileSync(pointPath(label, after))) as ResumePoint;
  requireThat(point.format === 2, "resume_format", "Use a current resume point.");
  return point;
}
/** The land of a saved epoch on its own lattice, opened without running anything. */
export function openResumeLand(label: string, after: string[]) {
  const point = readResumePoint(label, after);
  return { map: restoreLand(point.lattice, point.field), profile: point.lattice.profile };
}

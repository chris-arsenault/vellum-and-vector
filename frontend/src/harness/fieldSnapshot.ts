import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { requireThat, triangleArea, type Epoch } from "@atlas/domain";
import type { PhysicalContext } from "../../../packages/generation/src/world/context";
import {
  createField,
  physicalBands,
  isMutablePhysicalName,
  type PhysicalBufferName,
  type PhysicalField,
} from "../../../packages/generation/src/world/field";
import {
  importGroundBand,
  finishGroundImport,
} from "../../../packages/generation/src/rock/groundResources";
import { createWorldMesh } from "../../../packages/generation/src/world/worldMesh";
import { harnessRoot } from "./harnessWorkspace";
import { nativeWorkload } from "./nativeWorkload";

/**
 * The world's whole physical state at the start of a pass, saved so a stage can be run again in
 * seconds instead of generating the world. One run records them; later work resumes from them.
 * Only the physical field is kept: magic and ecology do not run in a resumed stage.
 */
const snapshotRoot = join(harnessRoot, "snapshots");
/** A step after which the next thing to run is the start of a pass, and which pass that is. */
function passStartingAfter(name: string, context: PhysicalContext, lastInitialStep: string) {
  if (name === lastInitialStep) return 0;
  return name === "physical-epoch-history" ? context.EpochIndex + 1 : null;
}
/** State a field holds beside its bands and plain numbers. */
const heldState = [
  "tectonics",
  "landmarkLedger",
  "crustBudget",
  "events",
  "faults",
  "ThrustSlipOwed",
] as const;
interface Snapshot {
  lengthUnits: "relative";
  failure?: FailedField;
  epochs: Epoch[];
  worldSize: [number, number, number, number];
  quality: string;
  seed: number;
  profile: PhysicalContext["Profile"];
  spacing: number;
  count: number;
  bands: Record<string, Float64Array>;
  plain: Record<string, number | boolean>;
  held: Record<string, unknown>;
}
/** A failed field is diagnostic evidence, never a completed epoch or resumable workload. */
export interface FailedField {
  status: "failed";
  message: string;
  lastObservedStep: string;
  lastObservedEpoch: number;
}
function capture(
  map: PhysicalField,
  context: PhysicalContext,
  quality: string,
  salt: number,
  epochs: Epoch[]
): Snapshot {
  const bands: Snapshot["bands"] = {},
    plain: Snapshot["plain"] = {},
    held: Snapshot["held"] = {};
  for (const [name, value] of physicalBands(map)) bands[name] = Float64Array.from(value.toArray());
  for (const [name, value] of Object.entries(map))
    if (typeof value === "number" || typeof value === "boolean") plain[name] = value;
  for (const name of heldState) held[name] = map[name];
  return {
    lengthUnits: "relative",
    epochs,
    worldSize: map.mesh.bounds as Snapshot["worldSize"],
    quality,
    seed: context.EpochStableSeed ^ salt,
    profile: context.Profile,
    spacing: map.mesh.spacing,
    count: map.mesh.count,
    bands,
    plain,
    held,
  };
}
/** Saves the state at each pass's start, into a named set of snapshots. */
export function snapshotRecorder(label: string, quality: string, epochs: Epoch[]) {
  const directory = join(snapshotRoot, label);
  const lastInitialStep = nativeWorkload()
    .filter(({ path }) => path[0].startsWith("formation/"))
    .at(-1)!.step;
  mkdirSync(directory, { recursive: true });
  // The step that ends the first forming runs again in later passes; only its first run counts.
  const saved = new Set<number>();
  return (name: string, map: PhysicalField, context: PhysicalContext) => {
    const pass = passStartingAfter(name, context, lastInitialStep[0]);
    if (pass === null || saved.has(pass)) return false;
    saved.add(pass);
    writeFileSync(
      join(directory, `pass-${pass}.bin`),
      serialize(capture(map, context, quality, pass === 0 ? lastInitialStep[1] : 0, epochs))
    );
    return true;
  };
}
export const snapshotPath = (label: string, pass: number | "failure") =>
  join(snapshotRoot, label, pass === "failure" ? "failure.bin" : `pass-${pass}.bin`);
/** Capture the mutated field, while identifying the context as the last observed boundary. */
export function captureFailedField(
  input: { label: string; quality: string; seed: number; epochs: Epoch[] },
  map: PhysicalField,
  context: PhysicalContext,
  failure: FailedField
) {
  const path = snapshotPath(input.label, "failure");
  mkdirSync(join(snapshotRoot, input.label), { recursive: true });
  writeFileSync(
    path,
    serialize({
      ...capture(map, context, input.quality, 0, input.epochs),
      seed: input.seed,
      failure,
    })
  );
  return path;
}
/** The same lattice the world ran on, from what the snapshot recorded about it. */
function latticeOf(snapshot: Snapshot) {
  const [west, south, east, north] = snapshot.worldSize,
    padding = snapshot.profile.BoundaryPadding,
    // Recorded geometry is data: a new generation policy must not resize an old snapshot.
    cellArea = snapshot.spacing ** 2 * triangleArea,
    samples = ((east - west + 2 * padding) * (north - south + 2 * padding)) / cellArea,
    wraps = snapshot.profile.WrapLongitude === 1;
  return createWorldMesh(
    [west, south, east, north],
    samples,
    padding,
    () => true,
    (east - west) * (north - south),
    [(west + east) / 2, (south + north) / 2],
    wraps,
    wraps && snapshot.profile.LatitudeSouth === -90 && snapshot.profile.LatitudeNorth === 90
  );
}
/** A field exactly as it stood when the snapshot was taken. */
export function restoreSnapshot(path: string, allowFailedInspection = false) {
  const snapshot = deserialize(readFileSync(path)) as Snapshot;
  requireThat(
    snapshot.lengthUnits === "relative",
    "snapshot_format",
    "Use a current field snapshot."
  );
  requireThat(Array.isArray(snapshot.epochs), "snapshot_epochs", "Snapshot is missing its epochs.");
  requireThat(
    !snapshot.failure || allowFailedInspection,
    "snapshot_failed",
    "A failed field is inspection-only: use HARNESS_PASSES=0."
  );
  const mesh = latticeOf(snapshot);
  if (mesh.count !== snapshot.count || mesh.spacing !== snapshot.spacing)
    throw new Error(
      `Snapshot lattice differs: ${snapshot.count} cells at ${snapshot.spacing}, rebuilt ${mesh.count} at ${mesh.spacing}.`
    );
  const map = createField(mesh);
  const imported = new Set<PhysicalBufferName>();
  for (const [name] of physicalBands(map)) {
    const values = snapshot.bands[name];
    requireThat(values, "snapshot_field", `Snapshot is missing ${name}.`);
    imported.add(name);
    if (isMutablePhysicalName(name))
      for (let i = 0; i < values.length; i++) map[name].set(i, values[i]);
    else importGroundBand(map, name, values);
  }
  Object.assign(map, snapshot.plain, snapshot.held);
  finishGroundImport(map, imported);
  return {
    map,
    seed: snapshot.seed,
    profile: snapshot.profile,
    epochs: snapshot.epochs,
    failure: snapshot.failure,
  };
}

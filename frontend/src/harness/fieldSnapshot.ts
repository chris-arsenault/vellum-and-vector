import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { Band } from "@atlas/domain";
import type { PhysicalContext } from "../../../packages/generation/src/canonry/context";
import { createField, type PhysicalField } from "../../../packages/generation/src/canonry/field";
import { initialSteps } from "../../../packages/generation/src/canonry/sequence";
import { createWorldMesh } from "../../../packages/generation/src/canonry/worldMesh";
import { generationResolution } from "../../../packages/generation/src/resolution";
import { harnessRoot } from "./harnessWorkspace";

/**
 * The world's whole physical state at the start of a pass, saved so a stage can be run again in
 * seconds instead of generating the world. One run records them; later work resumes from them.
 * Only the physical field is kept: magic and ecology do not run in a resumed stage.
 */
const snapshotRoot = join(harnessRoot, "snapshots");
const lastInitialStep = initialSteps[initialSteps.length - 1][0];
/** A step after which the next thing to run is the start of a pass, and which pass that is. */
function passStartingAfter(name: string, context: PhysicalContext) {
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
  worldSize: [number, number, number, number];
  quality: string;
  seed: number;
  profile: PhysicalContext["Profile"];
  spacing: number;
  count: number;
  bands: Record<string, Float64Array>;
  plain: Record<string, number | boolean>;
  held: Record<string, unknown>;
  facts: string[];
}
function capture(map: PhysicalField, context: PhysicalContext, quality: string): Snapshot {
  const bands: Snapshot["bands"] = {},
    plain: Snapshot["plain"] = {},
    held: Snapshot["held"] = {};
  for (const [name, value] of Object.entries(map)) {
    if (value instanceof Band && value.length === map.mesh.count)
      bands[name] = Float64Array.from({ length: value.length }, (_, i) => value.get(i));
    else if (typeof value === "number" || typeof value === "boolean") plain[name] = value;
  }
  for (const name of heldState) held[name] = map[name];
  return {
    worldSize: map.mesh.bounds as Snapshot["worldSize"],
    quality,
    seed: context.EpochStableSeed,
    profile: context.Profile,
    spacing: map.mesh.spacing,
    count: map.mesh.count,
    bands,
    plain,
    held,
    facts: [...map.AvailableFacts],
  };
}
/** Saves the state at each pass's start, into a named set of snapshots. */
export function snapshotRecorder(label: string, quality: string) {
  const directory = join(snapshotRoot, label);
  mkdirSync(directory, { recursive: true });
  // The step that ends the first forming runs again in later passes; only its first run counts.
  const saved = new Set<number>();
  return (name: string, map: PhysicalField, context: PhysicalContext) => {
    const pass = passStartingAfter(name, context);
    if (pass === null || saved.has(pass)) return;
    saved.add(pass);
    writeFileSync(join(directory, `pass-${pass}.bin`), serialize(capture(map, context, quality)));
  };
}
export const snapshotPath = (label: string, pass: number) =>
  join(snapshotRoot, label, `pass-${pass}.bin`);
/** The same lattice the world ran on, from what the snapshot recorded about it. */
function latticeOf(snapshot: Snapshot) {
  const [west, south, east, north] = snapshot.worldSize,
    padding = snapshot.profile.BoundaryPadding,
    span = generationResolution(snapshot.quality as "draft", "world").cellSpan,
    samples = ((east - west + 2 * padding) * (north - south + 2 * padding)) / span ** 2,
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
export function restoreSnapshot(path: string) {
  const snapshot = deserialize(readFileSync(path)) as Snapshot,
    mesh = latticeOf(snapshot);
  if (mesh.count !== snapshot.count || mesh.spacing !== snapshot.spacing)
    throw new Error(
      `Snapshot lattice differs: ${snapshot.count} cells at ${snapshot.spacing}, rebuilt ${mesh.count} at ${mesh.spacing}.`
    );
  const map = createField(mesh);
  for (const [name, values] of Object.entries(snapshot.bands)) {
    const band = map[name as keyof PhysicalField] as Band | undefined;
    if (band instanceof Band) for (let i = 0; i < values.length; i++) band.set(i, values[i]);
  }
  Object.assign(map, snapshot.plain, snapshot.held);
  map.AvailableFacts = new Set(snapshot.facts);
  return { map, seed: snapshot.seed, profile: snapshot.profile };
}

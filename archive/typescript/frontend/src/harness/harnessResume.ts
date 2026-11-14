import { generateWorld, type RunObservers } from "./harnessGeneration";
import {
  checkpointDirectory,
  currentCommit,
  openHarnessWorkspace,
  removeCheckpoint,
  type CheckpointRecord,
} from "./harnessWorkspace";
import { readResumeSource, resumeFrom } from "./resumePoint";
import type { HarnessOptions } from "./harness";

interface ResumeRun {
  options: HarnessOptions;
  out: string;
  /** The harness's live recorder for this map: its observers and what it has seen. */
  recorder: { observers: RunObservers; highestLand(): [number, number] | undefined };
  write(directory: string, name: string, value: unknown): void;
}
/**
 * A saved run continued after one of its completed epochs: the same installed world and
 * request, with the land, magic and recorded history restored at that epoch's end, and every
 * later epoch and the present generated as usual. Nothing before the resume point runs again:
 * `HARNESS_RESUME=draft HARNESS_AFTER=<epoch id> pnpm --dir frontend harness regional`.
 * The report's `resumed-from` names the saved run it continued and the commit that saved it.
 */
export async function resumeWorld({
  options,
  out,
  recorder,
  write,
}: ResumeRun): Promise<CheckpointRecord> {
  const source = readResumeSource(options.resume),
    after = options.resumeAfter.split("/").filter(Boolean),
    name = `${options.world}-resumed`,
    started = performance.now();
  if (!after.length) throw new Error("Name the completed epoch to continue after: HARNESS_AFTER.");
  removeCheckpoint(name);
  const ws = await openHarnessWorkspace(checkpointDirectory(name)),
    resumedFrom = { label: options.resume, after, commit: source.commit };
  write(out, "resumed-from", { ...resumedFrom, savedAt: source.createdAt });
  try {
    const limit = options.stopSeconds * 1000,
      observers: RunObservers = {
        ...recorder.observers,
        resume: resumeFrom(options.resume, after),
        stop: () => limit > 0 && performance.now() - started > limit,
      };
    const { worldId, root } = await generateWorld(ws, source.draft, observers, source.snapshot);
    const record: CheckpointRecord = {
      kind: "world",
      name,
      worldId,
      root,
      seed: source.draft.recipe.seed,
      quality: source.draft.recipe.quality,
      width: source.draft.width,
      height: source.draft.height,
      position: recorder.highestLand(),
      commit: currentCommit(),
      createdAt: new Date().toISOString(),
      resumedFrom,
    };
    await ws.save(record);
    return record;
  } finally {
    write(out, "world-run", { ...recorder, seconds: (performance.now() - started) / 1000 });
    await ws.close();
  }
}

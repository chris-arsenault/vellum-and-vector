import { basename } from "node:path";
import type { HarnessOptions } from "./harness";
import { refineRegion } from "./harnessGeneration";
import {
  checkpointDirectory,
  copyCheckpoint,
  currentCommit,
  openHarnessWorkspace,
  readCheckpoint,
  removeCheckpoint,
} from "./harnessWorkspace";
import { quickTerrain } from "./quickTerrain";
import { groundChangeWatch } from "./groundChange";
import { startProcessProbe } from "./processProbe";
import { write } from "./harnessWrite";

/** Inspect physical development from a copy of a saved map; optionally finish and save it. */
export async function quickRegion(options: HarnessOptions, out: string) {
  const world = readCheckpoint(options.world);
  if (!world) throw new Error(`No saved world named ${options.world}.`);
  const at = options.regionAt ?? world.position;
  if (!at) throw new Error("Give HARNESS_REGION_AT=x,y: the world records no highest land.");
  const quickCheckpoint = `quick-${process.pid}-${basename(out)}`;
  copyCheckpoint(world.name, quickCheckpoint);
  const ws = await openHarnessWorkspace(checkpointDirectory(quickCheckpoint)),
    started = performance.now(),
    stopProcesses = startProcessProbe(
      options.processAt,
      options.processBands,
      (samples) => write(out, "quick-region-processes", samples),
      {
        cells: options.groundCells ?? [],
        publish: (samples) => write(out, "quick-region-ground", samples),
      }
    );
  let done = false,
    stage = 0;
  const watch = groundChangeWatch();
  const observers = {
    inspect(_path: string[], process: string, state: Parameters<typeof quickTerrain>[0]) {
      const seconds = () => Math.round((performance.now() - started) / 1000);
      if (state.physical) write(out, "ground-changes", watch.look(process, state.physical.map));
      if (process === "refinement.relief" || process === "refinement.round")
        report(quickTerrain(state, out, `${process.split(".")[1]}-${stage++}`), seconds());
      if (process === quickUntil) report(quickTerrain(state, out), seconds());
      if (!options.saveQuick && process === quickUntil) done = true;
    },
    stop: () => done,
  };
  try {
    const { child } = await refineRegion(
      ws,
      world.worldId,
      { x: at[0], y: at[1], z: 0 },
      options.regionQuality,
      observers,
      ["physical"],
      world.child ?? world.root
    );
    if (options.saveQuick) {
      await ws.save({
        ...world,
        kind: "region",
        name: options.region,
        world: world.name,
        child,
        quality: options.regionQuality,
        position: at,
        commit: currentCommit(),
        createdAt: new Date().toISOString(),
      });
      copyCheckpoint(quickCheckpoint, options.region);
    }
  } catch (error) {
    if (!done) throw error;
  } finally {
    try {
      stopProcesses();
    } finally {
      await ws.close();
      removeCheckpoint(quickCheckpoint);
    }
  }
}
const quickUntil = "refinement.refresh";
const report = (data: object, seconds: number) =>
  process.stdout.write(`\n${seconds} s ${JSON.stringify(data)}\n`);

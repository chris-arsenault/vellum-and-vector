import {
  answerKeys,
  capturedAnswersAt,
  explainAnswer,
} from "../../../packages/generation/src/coupling/answers";
import {
  physicalSchema,
  type PhysicalBufferName,
} from "../../../packages/generation/src/world/field";
import {
  observeNativeProcesses,
  type NativeProcessObserver,
} from "../../../packages/generation/src/world/physicalSteps";
import { groundProbe } from "./groundProbe";

const defaultBands: readonly PhysicalBufferName[] = [
  "Elevation",
  "SedimentThickness",
  "RockKindCodes",
  "Runoff",
  "Temperature",
  "IceThickness",
];
/** Select actual field bands, so inspecting a new process needs no probe implementation change. */
export function processProbeBands(text: string): readonly PhysicalBufferName[] {
  if (!text.trim()) return defaultBands;
  const known = new Set(physicalSchema().map(({ name }) => name)),
    names = text.split(",").map((name) => name.trim());
  for (const name of names)
    if (!known.has(name as PhysicalBufferName))
      throw new Error(`Unknown process probe band: ${name}`);
  return [...new Set(names)] as PhysicalBufferName[];
}

/** Samples one location; no full-field scans or retained field references per process. */
export function processProbe(
  at: readonly [number, number],
  bands: readonly PhysicalBufferName[] = defaultBands
) {
  const samples: object[] = [];
  const observe: NativeProcessObserver = (step, event, map, context) => {
    const cell = map.mesh.cellAt(at[0] - map.mesh.origin[0], at[1] - map.mesh.origin[1]);
    if (cell < 0) return;
    samples.push({
      step,
      epoch: context.EpochIndex,
      ...event,
      at,
      cell,
      fields: Object.fromEntries(bands.map((name) => [name, map[name].get(cell)])),
      capturedAnswers: capturedAnswersAt(map, cell),
      // These explain the facts at this boundary, not the group's earlier cached inputs.
      answers: Object.fromEntries(
        answerKeys.map((key) => [key, explainAnswer(map, key, cell, context)])
      ),
    });
  };
  return { observe, read: () => samples };
}

/** A point probe has its own lifecycle, independent of whole-world relief diagnostics. */
export function startProcessProbe(
  at: readonly [number, number] | undefined,
  bands: readonly PhysicalBufferName[] | undefined,
  publish: (samples: object[]) => void,
  ground?: { cells: readonly number[]; publish: (samples: object[]) => void }
) {
  if (!at && !ground?.cells.length) return () => {};
  const probe = at && processProbe(at, bands),
    material = ground?.cells.length ? groundProbe(ground.cells) : undefined;
  observeNativeProcesses((...args) => {
    probe?.observe(...args);
    material?.observe(...args);
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    observeNativeProcesses(null);
    material?.stop();
    if (probe) publish(probe.read());
    if (material) ground!.publish(material.read());
  };
}

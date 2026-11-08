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
import type { NativeStep } from "../../../packages/generation/src/world/sequence";
import { watchGroundTransfers } from "../../../packages/generation/src/rock/groundTransport";

/** Optional transfer counts for a captured interval; selected material probes replace this scan. */
export function movementObserver(count: number) {
  const counts = {
      operations: {
        "plate-placement": 0,
        "plate-remap": 0,
        "rock-accretion": 0,
        "cover-accretion": 0,
        "sheet-move": 0,
      },
      acceptedRock: 0,
      acceptedCover: 0,
      sourceChanges: 0,
    },
    cells = new Set(Array.from({ length: count }, (_, cell) => cell));
  let previousSource = -1;
  const stop = watchGroundTransfers(cells, (event) => {
    if (event.phase !== "after") return;
    counts.operations[event.operation]++;
    if (event.operation === "rock-accretion") {
      if ((event.accepted ?? 0) > 0) counts.acceptedRock++;
      if (event.source !== previousSource) counts.sourceChanges++;
      previousSource = event.source;
    }
    if (event.operation === "cover-accretion" && (event.accepted ?? 0) > 0) counts.acceptedCover++;
  });
  return { counts, stop };
}

/** Harness-only elapsed native operations; nested entries are included in their parent's time. */
export function timedNativeStep(
  step: NativeStep,
  timings: { step: string; ms: number }[]
): NativeStep {
  return [
    step[0],
    step[1],
    (map, context) => {
      const started = performance.now();
      try {
        step[2](map, context);
      } finally {
        timings.push({ step: step[0], ms: performance.now() - started });
      }
    },
    step[3],
  ];
}

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

import type { PhysicalBufferName, PhysicalField } from "./field";
import type { PhysicalContext, ProcessObservation } from "./context";
import { validateNativeLayer } from "./layerValidation";
import type { NativeStep } from "./sequence";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { nativeStepsOf } from "../physicalFeature";

/**
 * What a world step works from and leaves behind, gathered from the processes it runs. A step that needs
 * a band cannot run unless a selected step wrote it earlier, or the map inherited it. That is all this
 * says: a band's being written says nothing about whether it is still right, and a band a step can do
 * without is not listed, because an unwritten band reads as nothing happened.
 */
export interface PhysicalStep {
  readonly needs: readonly PhysicalBufferName[];
  readonly writes: readonly PhysicalBufferName[];
  readonly leaves: readonly string[];
  /** Whether it moves loose material, so the sediment's books are checked after it. */
  readonly movesMaterial: boolean;
}
const carried = new Set(["load", "loose"]);
export function describeNativeStep([, , , processes]: NativeStep): PhysicalStep {
  const unique = <T>(values: readonly T[]) => [...new Set(values)];
  return {
    needs: unique(processes.flatMap((each) => each.needs ?? [])),
    writes: unique(processes.flatMap((each) => each.provides ?? [])),
    leaves: unique(processes.flatMap((each) => each.leaves ?? [])),
    movesMaterial: processes.some((each) =>
      each.moves.some(([from, to]) => carried.has(from) || carried.has(to))
    ),
  };
}
/** Every step a world can run, by name, each once. */
export const allSteps: readonly NativeStep[] = nativeStepsOf(physicalFeatureDefinitions);
export const physicalSteps: Readonly<Record<string, PhysicalStep>> = Object.fromEntries(
  allSteps.map((step) => [step[0], describeNativeStep(step)])
);
/** The ledger's name for a band having been written. */
export const fieldProduct = (band: PhysicalBufferName) => `field:${band}`;
/** Something watching the world's steps as they finish, to record what each one did. */
export type NativeStepObserver = (
  name: string,
  map: PhysicalField,
  context: PhysicalContext
) => void;
let stepObserver: NativeStepObserver | null = null;
export function observeNativeSteps(observer: NativeStepObserver | null) {
  stepObserver = observer;
}
export type NativeProcessObserver = (
  step: string,
  event: ProcessObservation,
  map: PhysicalField,
  context: PhysicalContext
) => void;
let processObserver: NativeProcessObserver | null = null;
/** Optional harness inspection at process boundaries, including joint stage settlement. */
export function observeNativeProcesses(observer: NativeProcessObserver | null) {
  processObserver = observer;
}
/** Runs the native operation with inspection, without imposing world publication validation. */
export function runNativeStep(map: PhysicalField, context: PhysicalContext, step: NativeStep) {
  const [name, , process] = step,
    observer = processObserver;
  process(
    map,
    observer
      ? {
          ...context,
          ObserveProcess: (event, field, executionContext) => {
            context.ObserveProcess?.(event, field, executionContext);
            observer(name, event, field, executionContext);
          },
        }
      : context
  );
}
/** Plate motion has salt zero; each embedded operation keeps its own seed and interval. */
export function withPlateDeformation(
  map: PhysicalField,
  context: PhysicalContext,
  steps: readonly NativeStep[]
): PhysicalContext {
  return {
    ...context,
    DuringPlateStep: (interval) => {
      for (const step of steps)
        applyNativeStep(
          map,
          {
            ...interval,
            Seed: interval.Seed ^ step[1],
            EpochStableSeed: interval.EpochStableSeed ^ step[1],
          },
          step
        );
    },
  };
}
/** Runs a step, then checks what it left within the physical ranges its bands must hold. */
export function applyNativeStep(map: PhysicalField, context: PhysicalContext, step: NativeStep) {
  const [name] = step;
  try {
    runNativeStep(map, context, step);
    validateNativeLayer(map, context, describeNativeStep(step).writes);
    stepObserver?.(name, map, context);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${name} failed in epoch ${context.EpochIndex + 1}: ${detail}`, { cause });
  }
}

import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";

type Operation = (state: GenerationState, context: MapProcessContext) => void | Promise<void>;
export type DurationBinding =
  { kind: "years"; years: number } | { kind: "epoch"; fraction: number };

export type ProcessBehavior =
  | { kind: "initialize"; initialize: Operation }
  | { kind: "model-pass"; applyPass: Operation }
  | {
      kind: "elapsed";
      duration: DurationBinding;
      advance(
        state: GenerationState,
        context: MapProcessContext,
        years: number
      ): void | Promise<void>;
    }
  | { kind: "transfer"; transfer: Operation }
  | { kind: "extract"; extract: Operation }
  | { kind: "forcing-contributor"; contribute: Operation }
  | {
      kind: "material-transformation";
      transform: Operation;
      balance(state: GenerationState, context: MapProcessContext): void;
    };

/** Dispatches operational interfaces; it never infers time from world settings. */
export function executeProcessBehavior(
  process: MapProcess,
  state: GenerationState,
  context: MapProcessContext
) {
  const behavior = process.behavior;
  if (!behavior) {
    requireThat(process.apply, "process_behavior", `Bind an operation for ${process.contract.id}.`);
    return process.apply(state, context);
  }
  switch (behavior.kind) {
    case "initialize":
      return behavior.initialize(state, context);
    case "model-pass":
      return behavior.applyPass(state, context);
    case "elapsed":
      return behavior.advance(state, context, elapsedYears(behavior.duration, context));
    case "transfer":
      return behavior.transfer(state, context);
    case "extract":
      return behavior.extract(state, context);
    case "forcing-contributor":
      return behavior.contribute(state, context);
    case "material-transformation":
      return transformMaterial(behavior, state, context);
  }
}
export function validateBehaviorBinding(
  process: MapProcess,
  context: Pick<MapProcessContext, "epochs">
) {
  if (process.behavior?.kind === "elapsed") elapsedYears(process.behavior.duration, context);
}
async function transformMaterial(
  behavior: Extract<ProcessBehavior, { kind: "material-transformation" }>,
  state: GenerationState,
  context: MapProcessContext
) {
  await behavior.transform(state, context);
  behavior.balance(state, context);
}
export function elapsedYears(binding: DurationBinding, context: Pick<MapProcessContext, "epochs">) {
  const years =
    binding.kind === "years"
      ? binding.years
      : context.epochs.at(-1)?.duration === undefined
        ? NaN
        : context.epochs.at(-1)!.duration * binding.fraction;
  requireThat(
    Number.isFinite(years) && years >= 0,
    "process_duration",
    "Bind a finite nonnegative duration to elapsed evolution."
  );
  return years;
}

import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import {
  selectOperation,
  defineCommand,
  defineQuery,
  readOperation,
  runOperation,
  type Command,
  type Query,
} from "./processOperation";

export type MapInput = {
  state: GenerationState;
  context: MapProcessContext;
  /** Direct invocation uses its parameters; dependencies bind their own selected settings. */
  invoked?: string;
};
export type DurationBinding =
  { kind: "years"; years: number } | { kind: "epoch"; fraction: number };
export type MapOperation =
  Query<MapInput> | (Command<MapInput> & { readonly duration?: DurationBinding });

export function mapCommand<Result extends void | Promise<void>>(
  id: string,
  kind: "initialize" | "event" | "publish",
  apply: (state: GenerationState, context: MapProcessContext) => Result,
  dependencies: readonly Query<MapInput>[]
) {
  return defineCommand(
    id,
    kind,
    ({ state, context }: MapInput) => apply(state, context),
    dependencies
  );
}
export function mapQuery(
  id: string,
  read: (state: GenerationState, context: MapProcessContext) => void,
  dependencies: readonly Query<MapInput>[]
) {
  return defineQuery(id, ({ state, context }: MapInput) => read(state, context), dependencies);
}
export function mapWork<Result extends void | Promise<void>>(
  id: string,
  exposure: (state: GenerationState, context: MapProcessContext) => number,
  apply: (state: GenerationState, context: MapProcessContext, exposure: number) => Result,
  dependencies: readonly Query<MapInput>[]
) {
  return defineCommand(
    id,
    "work",
    ({ state, context }: MapInput) => apply(state, context, workExposure(exposure(state, context))),
    dependencies
  );
}
export function mapElapsed<Result extends void | Promise<void>>(
  id: string,
  duration: DurationBinding,
  advance: (state: GenerationState, context: MapProcessContext, years: number) => Result,
  dependencies: readonly Query<MapInput>[]
) {
  return Object.assign(
    defineCommand(
      id,
      "elapsed",
      ({ state, context }: MapInput) => advance(state, context, elapsedYears(duration, context)),
      dependencies
    ),
    { duration }
  );
}
/** A physical workspace and its map-level consumers share one mutation revision. */
export const processOwner = (state: GenerationState) => state.physical?.map ?? state;
export function executeMapOperation(
  operation: MapOperation,
  state: GenerationState,
  context: MapProcessContext
) {
  const owner = processOwner(state);
  const input = { state, context, invoked: operation.id };
  if (operation.kind !== "query") return runOperation(owner, operation, input);
  selectOperation(owner, operation);
  return readOperation(owner, operation, input);
}
function workExposure(exposure: number) {
  requireThat(
    Number.isFinite(exposure) && exposure >= 0,
    "process_exposure",
    "Bind finite nonnegative work exposure."
  );
  return exposure;
}
export function validateOperationBinding(
  process: MapProcess,
  context: Pick<MapProcessContext, "epochs">
) {
  if ("duration" in process.operation && process.operation.duration)
    elapsedYears(process.operation.duration, context);
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

import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { ask } from "../coupling/answers";
import {
  commandBatch,
  defineCommand,
  defineQuery,
  readOperation,
  runOperation,
} from "../processOperation";
import "../coupling/responders";
import { Stage } from "../coupling/stage";
import { groundOf } from "../rock/ground";
import type { GroundProcess, PhysicalInput, StageWork, StageProcess } from "./groundProcess";
import { toolsFor } from "./processTools";

function workFor(
  map: PhysicalField,
  context: PhysicalContext,
  stage: Stage,
  substep: number,
  span: number
): StageWork {
  return {
    field: map,
    context,
    settings: context.Profile,
    ground: groundOf(map),
    span,
    substep,
    ask: (key) => ask(map, key, context),
    stage,
    tools: toolsFor(map),
  };
}
const substepsOf = (each: GroundProcess, context: PhysicalContext) =>
  Math.max(1, Math.round(each.substeps?.(context.Profile, context.Span) ?? 1));
/**
 * The driver: runs processes in substeps the finest of their step rules asks for, each a stage that
 * settles at its end, with each substep's share of the span. Together, every process does a substep
 * on the same ground and the stage shares out what they compete for; in turn, each runs all its own.
 */
function inSubsteps(
  map: PhysicalField,
  context: PhysicalContext,
  processes: readonly StageProcess[],
  simultaneous: boolean
) {
  const stage = new Stage(map, { simultaneous }),
    count = Math.max(...processes.map((each) => substepsOf(each, context))),
    operations = processes.map((each) => each.prepare(map)),
    questions = new Set(processes.flatMap((each) => each.asks));
  for (let substep = 0; substep < count; substep++) {
    // Resolve the group's inputs before any participant runs. The next group reads landed effects.
    for (const key of questions) ask(map, key, context);
    groundOf(map).heldBy(ask(map, "rootHold", context));
    const work = workFor(map, context, stage, substep, context.Span / count);
    commandBatch(map, () => {
      for (const [index, each] of processes.entries()) {
        context.ObserveProcess?.({ processes: [each.id], phase: "before", substep }, map, context);
        runOperation(map, operations[index], work);
        context.ObserveProcess?.(
          { processes: [each.id], phase: "after-run", substep },
          map,
          context
        );
      }
      stage.settle();
    });
    context.ObserveProcess?.(
      {
        processes: processes.map((each) => each.id),
        phase: "settled",
        substep,
      },
      map,
      context
    );
  }
}
/** Runs in order; each process and substep sees the previous one's landed effects. */
export const actBy =
  (...processes: readonly GroundProcess[]) =>
  (map: PhysicalField, context: PhysicalContext) => {
    for (const each of processes) {
      if (each.execution === "stage") inSubsteps(map, context, [each], false);
      else if (each.operation.kind === "query")
        readOperation(map, each.operation, { map, context });
      else {
        context.ObserveProcess?.(
          { processes: [each.id], phase: "before", substep: 0 },
          map,
          context
        );
        runOperation(map, each.operation, { map, context });
        context.ObserveProcess?.(
          { processes: [each.id], phase: "settled", substep: 0 },
          map,
          context
        );
      }
      each.check?.(map, context);
    }
  };
/**
 * Runs a step's processes together, substep by substep on the same ground, so where they compete for
 * material they share it. A body on the whole field, or a solver that settles itself, cannot join.
 */
export const actTogether = (...processes: readonly GroundProcess[]) => {
  const alone = processes.find((each) => each.execution !== "stage" || each.settlesItself);
  if (alone) throw new Error(`${alone.id} cannot run together with others.`);
  return (map: PhysicalField, context: PhysicalContext) => {
    inSubsteps(
      map,
      context,
      processes.filter((each) => each.execution === "stage"),
      true
    );
    for (const each of processes) each.check?.(map, context);
  };
};

/** Composition takes its lifecycle from explicit executable children, never a default pass. */
export function nativeOperation(
  name: string,
  processes: readonly GroundProcess[],
  together = false
) {
  const kinds = processes.map((process) =>
    process.execution === "stage" ? "work" : process.operation.kind
  );
  const execute = together ? actTogether(...processes) : actBy(...processes);
  const apply = ({ map, context }: PhysicalInput) => execute(map, context);
  if (kinds.every((kind) => kind === "query")) return defineQuery(name, apply, []);
  if (kinds.includes("work")) return defineCommand(name, "work", apply, []);
  if (kinds.includes("event")) return defineCommand(name, "event", apply, []);
  if (kinds.every((kind) => kind === "initialize" || kind === "query"))
    return defineCommand(name, "initialize", apply, []);
  throw new Error(`Unsupported native lifecycle composition: ${name}`);
}

import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";
import { ask, worldMoved } from "../coupling/answers";
import "../coupling/responders";
import { Stage } from "../coupling/stage";
import { groundOf } from "../rock/ground";
import {
  burial,
  crustUplift,
  impacts,
  margins,
  moraines,
  mountains,
  plates,
  riverLoad,
  seaFloor,
  settling,
  shoreDetail,
  volcanoes,
} from "./builders";
import {
  airMoisture,
  airTemperature,
  currents,
  landBodies,
  oceanFill,
  rainfall,
  seaFloorZones,
  seaFreezing,
  shoreDistance,
  warmth,
  winds,
} from "./climateProcesses";
import { coast, outsideWaves } from "./coast";
import {
  baking,
  crustHeat,
  domains,
  epochActivity,
  epochRecord,
  finalCheck,
  firstLandscape,
  fractures,
  marginKinds,
  plumeRoots,
  provinceLayout,
  support,
  sutures,
} from "./crustProcesses";
import { creep } from "./creep";
import type { GroundProcess, ProcessReading, ProcessWork } from "./groundProcess";
import { ice } from "./ice";
import { toolsFor } from "./processTools";
import { slopes, slopesAfterStreams } from "./slopes";
import { solution } from "./solution";
import { streams } from "./streams";
import {
  channelForm,
  deltaForm,
  drainageFlood,
  drainageTurns,
  floodplainForm,
  iceBalance,
  iceLandforms,
  iceSpread,
  lakes,
  landforms,
  meltRunoff,
  meltwater,
  rivers,
  routing,
  waterOff,
} from "./waterProcesses";
import { weathering } from "./weathering";

/** Every process in a world's history. `sequence.ts` says when each runs. */
export const groundProcesses: readonly GroundProcess[] = [
  weathering,
  streams,
  solution,
  ice,
  slopes,
  slopesAfterStreams,
  creep,
  coast,
  plates,
  mountains,
  volcanoes,
  impacts,
  settling,
  riverLoad,
  moraines,
  seaFloor,
  burial,
  margins,
  shoreDetail,
  outsideWaves,
  crustUplift,
  provinceLayout,
  epochActivity,
  sutures,
  marginKinds,
  domains,
  firstLandscape,
  plumeRoots,
  fractures,
  crustHeat,
  support,
  baking,
  epochRecord,
  finalCheck,
  oceanFill,
  shoreDistance,
  seaFloorZones,
  landBodies,
  currents,
  warmth,
  airTemperature,
  winds,
  airMoisture,
  rainfall,
  seaFreezing,
  waterOff,
  drainageFlood,
  lakes,
  drainageTurns,
  routing,
  rivers,
  channelForm,
  floodplainForm,
  deltaForm,
  iceBalance,
  iceSpread,
  meltwater,
  meltRunoff,
  iceLandforms,
  landforms,
];
function workFor(
  map: PhysicalField,
  context: PhysicalContext,
  stage: Stage,
  substep: number,
  span: number
): ProcessWork<never, never> {
  return {
    field: map as never,
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
  processes: readonly GroundProcess[],
  simultaneous: boolean
) {
  const stage = new Stage(map, { simultaneous }),
    count = Math.max(...processes.map((each) => substepsOf(each, context)));
  groundOf(map).heldBy(ask(map, "rootHold", context));
  for (let substep = 0; substep < count; substep++) {
    const work = workFor(map, context, stage, substep, context.Span / count);
    for (const each of processes) (each.run as (w: ProcessWork<never, never>) => void)(work);
    stage.settle();
  }
}
/** Runs a step's processes in turn, each on what it declared, and checks what each must leave true. */
export const actBy =
  (...processes: readonly GroundProcess[]) =>
  (map: PhysicalField, context: PhysicalContext) => {
    worldMoved(map);
    for (const each of processes) {
      if (each.build) each.build(map, context);
      else inSubsteps(map, context, [each], false);
      each.check?.(map, context);
    }
  };
/**
 * Runs a step's processes together, substep by substep on the same ground, so where they compete for
 * material they share it. A body on the whole field, or a solver that settles itself, cannot join.
 */
export const actTogether = (...processes: readonly GroundProcess[]) => {
  const alone = processes.find((each) => each.build || each.settlesItself);
  if (alone) throw new Error(`${alone.id} cannot run together with others.`);
  return (map: PhysicalField, context: PhysicalContext) => {
    worldMoved(map);
    inSubsteps(map, context, processes, true);
    for (const each of processes) each.check?.(map, context);
  };
};
/** The settings processes read on a map of another scale: each says how its own change. */
export const profileAtScale = (
  profile: PhysicalProfile,
  reading: ProcessReading
): PhysicalProfile =>
  groundProcesses.reduce(
    (settings, each) => ({ ...settings, ...each.atScale?.(settings, reading) }),
    profile
  );

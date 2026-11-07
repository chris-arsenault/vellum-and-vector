import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";
import { ask, worldMoved } from "../coupling/answers";
import "../coupling/responders";
import { WearStage } from "../coupling/wearStage";
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
import { coast, outsideWaves } from "./coast";
import { creep } from "./creep";
import type { GroundProcess, ProcessReading, ProcessWork } from "./groundProcess";
import { ice } from "./ice";
import { toolsFor } from "./processTools";
import { slopes, slopesAfterStreams } from "./slopes";
import { solution } from "./solution";
import { streams } from "./streams";
import { weathering } from "./weathering";

/** Every process that acts on the ground. `sequence.ts` says when each runs. */
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
];
function workFor(map: PhysicalField, context: PhysicalContext): ProcessWork<never, never> {
  return {
    field: map as never,
    context,
    settings: context.Profile,
    ground: groundOf(map),
    span: context.Span,
    ask: (key) => ask(map, key, context),
    wear: new WearStage(map),
    tools: toolsFor(map),
  };
}
/** A step of the sequence that hands each process in turn only what it declared. */
export const actBy =
  (...processes: readonly GroundProcess[]) =>
  (map: PhysicalField, context: PhysicalContext) => {
    worldMoved(map);
    const work = workFor(map, context);
    for (const each of processes) {
      if (each.build) {
        each.build(map, context);
        continue;
      }
      (each.run as (w: ProcessWork<never, never>) => void)(work);
      work.wear.settle();
    }
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

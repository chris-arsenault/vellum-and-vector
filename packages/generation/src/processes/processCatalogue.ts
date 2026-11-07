import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import type { PhysicalProfile } from "../canonry/profile";
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
  outsideWaves,
  plates,
  riverLoad,
  seaFloor,
  settling,
  shoreDetail,
  volcanoes,
} from "./builders";
import { coast } from "./coast";
import { creep } from "./creep";
import type { GroundProcess, ProcessReading, ProcessWork } from "./groundProcess";
import { ice } from "./ice";
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
function workFor(map: PhysicalField, context: PhysicalContext): ProcessWork<never> {
  const span = context.Span;
  return {
    field: map as never,
    context,
    settings: context.Profile,
    ground: groundOf(map),
    span,
    ask: (key) => ask(map, key, context),
    wear: new WearStage(map),
    world: map,
  };
}
/** A step of the sequence that hands each process in turn only what it declared. */
export const actBy =
  (...processes: readonly GroundProcess[]) =>
  (map: PhysicalField, context: PhysicalContext) => {
    worldMoved(map);
    const work = workFor(map, context) as unknown as ProcessWork<never>;
    for (const each of processes) {
      (each.run as (w: ProcessWork<never>) => void)(work);
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

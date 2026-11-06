import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import type { PhysicalProfile } from "../canonry/profile";
import { groundOf } from "../rock/ground";
import type { GroundProcess, ProcessReading } from "./groundProcess";
import { ice } from "./ice";
import { slopes, slopesAfterStreams } from "./slopes";
import { solution } from "./solution";
import { streams } from "./streams";

/** Every process that acts on the ground. `sequence.ts` says when each runs. */
export const groundProcesses: readonly GroundProcess[] = [
  streams,
  solution,
  ice,
  slopes,
  slopesAfterStreams,
];
/** A step of the sequence that hands each process in turn its ground and settings. */
export const actBy =
  (...processes: readonly GroundProcess[]) =>
  (map: PhysicalField, context: PhysicalContext) => {
    const work = { map, context, settings: context.Profile, ground: groundOf(map) };
    for (const each of processes) each.run(work);
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

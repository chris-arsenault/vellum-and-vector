import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import type { PhysicalProfile } from "../canonry/profile";
import { groundOf } from "../rock/ground";
import { ice } from "./ice";
import { slopes, slopesAfterStreams } from "./slopes";
import { solution } from "./solution";
import { streams } from "./streams";
import type { WearProcess, WearReading } from "./wearContract";

/** Everything that wears the land. `sequence.ts` says when each runs. */
export const wearProcesses: readonly WearProcess[] = [
  streams,
  solution,
  ice,
  slopes,
  slopesAfterStreams,
];
/** A step of the sequence that gives each process in turn its ground and settings. */
export const wearBy =
  (...processes: readonly WearProcess[]) =>
  (map: PhysicalField, context: PhysicalContext) => {
    const work = { map, context, settings: context.Profile, ground: groundOf(map) };
    for (const each of processes) each.wear(work);
  };
/** The settings wear reads on a map of another scale: each process says how its own change. */
export const wearProfileAt = (profile: PhysicalProfile, reading: WearReading): PhysicalProfile =>
  wearProcesses.reduce(
    (settings, each) => ({ ...settings, ...each.atScale?.(settings, reading) }),
    profile
  );

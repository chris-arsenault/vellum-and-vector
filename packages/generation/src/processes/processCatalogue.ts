import type { PhysicalProfile } from "../world/profile";
import { allSteps } from "../world/physicalSteps";
import type { GroundProcess, ProcessReading } from "./groundProcess";
export { actBy, actTogether } from "./processRunner";

/** Feature operations supply the inventory: repeated steps share one process definition. */
export const groundProcesses: readonly GroundProcess[] = [
  ...new Set(allSteps.flatMap((step) => step[3])),
];
/** The settings processes read on a map of another scale: each says how its own change. */
export const profileAtScale = (
  profile: PhysicalProfile,
  reading: ProcessReading
): PhysicalProfile =>
  groundProcesses.reduce(
    (settings, each) => ({ ...settings, ...each.atScale?.(settings, reading) }),
    profile
  );

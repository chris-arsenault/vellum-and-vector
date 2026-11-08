import type { PhysicalProfile } from "../world/profile";
import { allSteps } from "../world/physicalSteps";
import type { GroundProcess, ProcessReading } from "./groundProcess";
export { actBy, actTogether } from "./processRunner";

/** Feature operations supply the inventory: repeated steps share one process definition. */
export const groundProcesses: readonly GroundProcess[] = [
  ...new Set(allSteps.flatMap((step) => step[3])),
];
/** Adjust execution cadence and reading policy without resolving geographic dimensions again. */
export const profileForExecution = (
  profile: PhysicalProfile,
  reading: ProcessReading
): PhysicalProfile =>
  groundProcesses.reduce(
    (settings, each) => ({ ...settings, ...each.forExecution?.(settings, reading) }),
    profile
  );

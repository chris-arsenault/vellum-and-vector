// PhysicalGeographyEvolutionSession.cs phase composition, Canonry 0f62584c.
import type { PhysicalEpoch } from "./context";
import {
  climateSteps,
  coastalSteps,
  drainageSteps,
  extractionSteps,
  geologySteps,
  glaciationSteps,
  glacialRunoffStep,
  historyStep,
  iceSteps,
  incisionSteps,
  initialSteps,
  meltwaterStep,
  sedimentStep,
  validationStep,
  type NativeStep,
} from "./sequence";

export interface ScheduledStep {
  step: NativeStep;
  epoch: PhysicalEpoch | null;
  index: number;
  phase: string;
}
function meltwaterDrainage(): NativeStep[] {
  return [drainageSteps[0], glacialRunoffStep, ...drainageSteps.slice(1)];
}
export function physicalSchedule(epochs: PhysicalEpoch[]): ScheduledStep[] {
  const schedule: ScheduledStep[] = [];
  const append = (
    steps: readonly NativeStep[],
    epoch: PhysicalEpoch | null,
    index: number,
    phase: string
  ) => {
    for (const step of steps) schedule.push({ step, epoch, index, phase });
  };
  // The reference session initializes through Apply(useEpoch: true): index zero,
  // even though no evolution epoch is bound yet.
  append(initialSteps, null, 0, "initial-geology");
  for (const [index, epoch] of epochs.entries()) {
    append(geologySteps, epoch, index, "geology");
    append(climateSteps, epoch, index, "climate");
    append(
      [...drainageSteps, ...incisionSteps, ...climateSteps, ...drainageSteps, sedimentStep],
      epoch,
      index,
      "hydrology"
    );
    append(glaciationSteps, epoch, index, "glaciation");
    append(
      [...climateSteps, ...drainageSteps, ...iceSteps, meltwaterStep, ...meltwaterDrainage()],
      epoch,
      index,
      "post-glacial"
    );
    append(coastalSteps, epoch, index, "coasts");
    append([historyStep], epoch, index, "history");
  }
  append(
    [
      ...climateSteps,
      ...drainageSteps,
      ...iceSteps,
      meltwaterStep,
      ...meltwaterDrainage(),
      ...iceSteps,
      ...extractionSteps,
      validationStep,
    ],
    null,
    -1,
    "present"
  );
  return schedule;
}

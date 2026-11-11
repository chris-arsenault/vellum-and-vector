import { mapElapsed, processOwner } from "./processTraits";
import { runOperation } from "./processOperation";
import type { MapProcess } from "./process";
import { applySocietyWorks } from "./societyWorks";
import { useSocietyMagic } from "./societyMagic";
import { advanceSocietyEnvironment } from "./societyEnvironment";
import { resolveSocietyHazards } from "./societyHazards";

const operations = {
  works: applySocietyWorks,
  "magic-use": useSocietyMagic,
  environment: advanceSocietyEnvironment,
  hazards: resolveSocietyHazards,
};
export const societyFeedbackProcesses: MapProcess[] = Object.entries(operations).map(
  ([id, advance]) => ({
    contract: {
      id: `human.${id}`,
      version: "1",
      parameters: {},
      requires: ["population"],
      produces: [`society:${id}`],
      invalidates: [],
    },
    operation: mapElapsed(
      `human.${id}`,
      { kind: "epoch", fraction: 1 },
      (state, context, years) =>
        runOperation(processOwner(state), advance, { state, context, years }),
      []
    ),
    validate: () => [],
  })
);

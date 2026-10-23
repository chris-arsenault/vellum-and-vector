import type { MapProcess } from "./process";
import { applySocietyWorks } from "./societyWorks";
import { useSocietyMagic } from "./societyMagic";
import { refreshSocietyEnvironment } from "./societyEnvironment";
import { resolveSocietyHazards } from "./societyHazards";

const operations = {
  works: applySocietyWorks,
  "magic-use": useSocietyMagic,
  environment: refreshSocietyEnvironment,
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
    behavior: { kind: "elapsed", duration: { kind: "epoch", fraction: 1 }, advance },
    validate: () => [],
  })
);

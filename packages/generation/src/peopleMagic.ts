import type { MapProcess } from "./process";
import { executeMapOperation, mapCommand } from "./processTraits";
import { evaluateSocietyMagic, publishCurrentMagic } from "./world/magicProcesses";

/**
 * Magic that answers to people. Some sources exist only where people have been: the dead of a
 * place, the years a seat has been kept, the lines and roads people hold. At the end of each
 * human era the fields are worked out again from the land as people have left it, so the next
 * era's people live with them and learn from them; once the eras are done, the map's magic is
 * published again. Nothing is supplied or aged here: only where each system now stands.
 */
const contract = (id: string, workspaceOnly: boolean) => ({
  id,
  version: "1",
  parameters: {},
  requires: ["atlas:workspace"],
  produces: [],
  invalidates: [],
  workspaceOnly,
});
export const humanMagicEra: MapProcess = {
  contract: contract("human.magic-era", true),
  operation: mapCommand(
    "human.magic-era",
    "event",
    (state, context) => {
      if (state.physical?.magic) executeMapOperation(evaluateSocietyMagic, state, context);
    },
    []
  ),
  validate: () => [],
};
export const humanMagicPresent: MapProcess = {
  contract: contract("human.magic-present", false),
  operation: mapCommand(
    "human.magic-present",
    "publish",
    (state, context) => {
      const published = Object.keys(state.surface.channels).some((name) =>
        name.startsWith("magic:")
      );
      if (state.physical?.magic && published)
        executeMapOperation(publishCurrentMagic, state, context);
    },
    []
  ),
  validate: () => [],
};
export const peopleMagicProcesses = [humanMagicEra, humanMagicPresent];

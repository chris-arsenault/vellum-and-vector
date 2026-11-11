import type { MapProcess } from "./process";
import { executeMapOperation, mapCommand } from "./processTraits";
import { publishCurrentMagic } from "./world/magicProcesses";

/**
 * Magic that answers to people. Some sources exist only where people have been: the dead of a
 * place, the years a seat has been kept, the lines and roads people hold. Once the eras are
 * done, the map's magic is worked out from the land as people left it and published again.
 */
export const humanMagicPresent: MapProcess = {
  contract: {
    id: "human.magic-present",
    version: "1",
    parameters: {},
    requires: ["atlas:workspace"],
    produces: [],
    invalidates: [],
    workspaceOnly: false,
  },
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

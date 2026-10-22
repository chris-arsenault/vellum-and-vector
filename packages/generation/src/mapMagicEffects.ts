import { putChannel, replaceChannel, channelValues } from "@atlas/domain";
import { magicalForcing } from "./mapMagic";
import { summarizeChannel } from "./mapFields";
import type { MapProcess } from "./process";

// The physical processes consume altered material resistance and coastal stress,
// following Canonry's interleaved magic/material feedback boundary.
export const materialMagicProcess: MapProcess = {
  contract: {
    id: "magic.material",
    version: "1",
    parameters: {
      sourceActivity: { type: "number", unit: "ratio", required: false, default: 1 },
      heatActivity: { type: "number", unit: "ratio", required: false, default: 1 },
      coldActivity: { type: "number", unit: "ratio", required: false, default: 1 },
    },
    requires: ["elevation", "geology"],
    produces: ["magicMaterial"],
    invalidates: [],
  },
  behavior: {
    kind: "forcing-contributor",
    contribute(state, context) {
      const grid = state.surface;
      if (!grid.channels.naturalRock)
        putChannel(grid, "naturalRock", "ratio", channelValues(grid, "rock").slice());
      const rock = channelValues(grid, "naturalRock").slice();
      const pressure = new Float64Array(grid.active.length);
      for (const source of state.domain.world.magic) {
        if (
          source.systemId ||
          ["heat", "cold"].includes(source.effect) ||
          (source.spaceId && source.spaceId !== context.scope.spaceId)
        )
          continue;
        const values = Float64Array.from(grid.active, (active, i) =>
          active ? magicalForcing(state, context, source, i) : 0
        );
        const key = `magic:${source.id}`;
        replaceChannel(grid, key, "ratio", values);
        for (let i = 0; i < values.length; i++) {
          if (source.effect === "erosionResistance")
            rock[i] = Math.max(0.1, Math.min(1, rock[i] + values[i] / 1000));
          if (source.effect === "pressure") pressure[i] += Math.abs(values[i]);
        }
        context.recordCause({
          kind: "magic",
          process: "magic.material",
          sourceId: source.id,
          activity: 1,
          forcing: summarizeChannel(grid, key),
          stored: summarizeChannel(grid, key),
        });
      }
      replaceChannel(grid, "rock", "ratio", rock);
      replaceChannel(grid, "coastalPressure", "ratio", pressure);
    },
  },
  validate() {
    return [];
  },
};

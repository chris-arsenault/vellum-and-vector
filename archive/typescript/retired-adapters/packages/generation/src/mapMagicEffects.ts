import { mapCommand } from "./processTraits";
import { putChannel } from "@atlas/domain";
import { magicalForcing } from "./mapMagic";
import { summarizeChannel, surfaceArray, surfaceValues } from "./mapFields";
import type { GenerationState, MapProcess } from "./process";
import { sampleSurfaceAtNative } from "./world/atlasWorkspace";
import { alterRock } from "./rock/rockField";

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
      react: { type: "boolean", unit: null, required: false, default: false },
    },
    requires: ["Elevation", "geology"],
    produces: ["magicMaterial"],
    invalidates: [],
  },
  operation: mapCommand(
    "magic.material",
    "event",
    (state, context) => {
      const grid = state.surface;
      const pressure = surfaceArray(state, "magic:coastal-pressure");
      for (const source of state.domain.world.magic) {
        if (
          source.systemId ||
          ["heat", "cold"].includes(source.effect) ||
          (source.spaceId && source.spaceId !== context.scope.spaceId)
        )
          continue;
        const values = surfaceValues(state, `magic:${source.id}`, (i) =>
          grid.active.get(i) ? magicalForcing(state, context, source, i) : 0
        );
        const key = `magic:${source.id}` as const;
        putChannel(grid, key, "ratio", values);
        if (source.effect === "erosionResistance" && context.parameters.react)
          alterSourceGround(state, key);
        if (source.effect === "pressure")
          for (let i = 0; i < values.length; i++) pressure.add(i, Math.abs(values.get(i)));
        context.recordCause({
          kind: "magic",
          process: "magic.material",
          sourceId: source.id,
          activity: 1,
          forcing: summarizeChannel(grid, key),
          stored: summarizeChannel(grid, key),
        });
      }
      putChannel(grid, "CoastalPressure", "ratio", pressure);
    },
    []
  ),
  validate() {
    return [];
  },
};

/** A material response changes the reached rock; subsequent forcing refreshes never reset it. */
function alterSourceGround(state: GenerationState, key: `magic:${string}`) {
  const map = state.physical!.map;
  for (let cell = 0; cell < map.mesh.count; cell++)
    alterRock(map, cell, sampleSurfaceAtNative(state, key, cell));
}

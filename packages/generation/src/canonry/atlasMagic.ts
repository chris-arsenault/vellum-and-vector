// Canonry MagicAdvectionLayer's dominant material-source mapping, adapted to
// user-configured signed thermal histories on the atlas's GIS grid.
import { allocateNumerical, fieldInterpolator, putChannel, spatial } from "@atlas/domain";
import type { MapProcess } from "../process";
import { nativePosition } from "./atlasWorkspace";

export const advectAtlasMagic: MapProcess = {
  contract: {
    id: "magic.advection",
    version: "0f62584c",
    parameters: {},
    requires: ["canonry:workspace"],
    produces: [],
    invalidates: [],
  },
  behavior: {
    kind: "transfer",
    transfer(state) {
      const grid = state.surface,
        work = state.physical!;
      const histories = Object.keys(grid.channels).filter(
        (name) => name.startsWith("magic:") && name.endsWith(":stored")
      );
      if (!histories.length) return;
      const covered = spatial.pointCoverage(grid.scope.footprint),
        sameTopology = grid.topology && grid.topology === work.map.mesh.topology;
      for (const name of histories) {
        const previous = { ...grid, channels: { [name]: grid.channels[name] } };
        const valueAt = fieldInterpolator(previous, name);
        // The moved history is a surface channel, so it lives in the surface arena.
        const moved = allocateNumerical(
          {
            type: "float64",
            length: grid.active.length,
            lifetime: "run",
            name: "magic:advected-history",
          },
          work.numerical
        );
        for (let i = 0; i < moved.length; i++) {
          const source = work.map.AdvectionSourceIndex.get(work.samples[i]);
          if (source < 0) continue;
          const p = nativePosition(work, source);
          if (covered(p))
            moved[i] = sameTopology
              ? previous.channels[name][work.map.mesh.cellToLeaf(source)]
              : valueAt(p);
        }
        putChannel(grid, name, grid.units[name], moved);
      }
    },
  },
  validate() {
    return [];
  },
};

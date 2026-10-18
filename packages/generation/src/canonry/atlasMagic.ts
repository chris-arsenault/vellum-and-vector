// Canonry MagicAdvectionLayer's dominant material-source mapping, adapted to
// user-configured signed thermal histories on the atlas's GIS grid.
import { interpolateSample, point, putChannel, spatial } from "@atlas/domain";
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
  apply(state) {
    const grid = state.surface,
      work = state.physical!;
    const histories = Object.keys(grid.channels).filter(
      (name) => name.startsWith("magic:") && name.endsWith(":stored")
    );
    for (const name of histories) {
      const previous = { ...grid, channels: { [name]: grid.channels[name].slice() } };
      const moved = new Float64Array(grid.active.length);
      for (let i = 0; i < moved.length; i++) {
        const source = work.map.AdvectionSourceIndex[work.samples[i]];
        if (source < 0) continue;
        const p = nativePosition(work, source);
        if (spatial.covers(grid.scope.footprint, point(p)))
          moved[i] = interpolateSample(previous, name, p);
      }
      putChannel(grid, name, grid.units[name], moved);
    }
  },
  validate() {
    return [];
  },
};

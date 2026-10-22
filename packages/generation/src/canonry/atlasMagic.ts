// Canonry MagicAdvectionLayer's dominant material-source mapping, adapted to
// user-configured signed thermal histories on the atlas's GIS grid.
import { fieldInterpolator, gridPosition, replaceChannel, spatial } from "@atlas/domain";
import type { MapProcess } from "../process";
import { provinceTransport } from "./provinceTransport";

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
      if (!histories.length || work.map.LastPlateDriftStep <= 0) return;
      const covered = spatial.pointCoverage(grid.scope.footprint),
        transport = provinceTransport(work.map);
      for (const name of histories) {
        const previous = { ...grid, channels: { [name]: grid.channels[name].slice() } };
        const valueAt = fieldInterpolator(previous, name);
        const moved = new Float64Array(grid.active.length);
        for (let i = 0; i < moved.length; i++) {
          const target = gridPosition(grid, i),
            source = transport.sourceAt(target.x, target.y);
          if (!source) continue;
          const p = { x: source[0], y: source[1], z: 0 };
          if (covered(p)) moved[i] = valueAt(p);
        }
        replaceChannel(grid, name, grid.units[name], moved);
      }
    },
  },
  validate() {
    return [];
  },
};

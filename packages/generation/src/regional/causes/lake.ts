import { noWaterSurface } from "../../canonry/math";
import { components, neighborsOf } from "../lattice";
import type { Evidence, RegionalState } from "../state";
import { registerCause } from "./registry";

/** Interpolated captured depth (m) above which ground beside a captured lake is lake. */
const lakeShoreDepth = 0.5;

/**
 * Captured standing water is a fact of the parent: its cells are roots of the network at its
 * level, the relief lies under it, and the routing keeps it standing (its basin, outlet and
 * supply are read in the network and the drainage). Its extent is read from the interpolated
 * depth rather than the category raster, so the shore follows the parent's depth taper
 * instead of its cell edges; the category decides that the water is a lake and not the sea.
 */
registerCause({
  kind: "lake",
  read(state, evidence) {
    evidence.lakes.push(...capturedLakes(state));
  },
});

function capturedLakes(state: RegionalState): Evidence["lakes"] {
  const map = state.physical.map,
    mesh = map.mesh,
    datum = map.EffectiveSeaLevel,
    lakes: Evidence["lakes"] = [],
    around = new Int32Array(mesh.stride),
    depth = (i: number) => map.WaterDepths.get(i) / 1024,
    lakeWater = (i: number) => {
      const kind = map.WaterKindCodes.get(i);
      if (kind === 1) return false;
      if (kind === 2) return depth(i) > lakeShoreDepth;
      if (depth(i) <= lakeShoreDepth) return false;
      const m = neighborsOf(mesh, i, around);
      for (let k = 0; k < m; k++) if (map.WaterKindCodes.get(around[k]) === 2) return true;
      return false;
    };
  components(mesh, lakeWater, (members) => {
    let level = 0,
      weight = 0;
    for (const i of members) {
      const surface = map.WaterSurfaceElevations.get(i),
        known = surface !== noWaterSurface;
      level += (known ? surface : state.regional.inheritedHeight.get(i) + depth(i) * 1024) - datum;
      weight++;
    }
    lakes.push({ cells: members, level: level / weight / 1024 });
  });
  return lakes;
}

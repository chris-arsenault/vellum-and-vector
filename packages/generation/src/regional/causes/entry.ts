import { frameEdge, isContent, neighborsOf, stepVector } from "../lattice";
import type { Evidence, RegionalState } from "../state";
import { registerCause } from "./registry";

/**
 * A captured river crossing the frame edge brings its upstream discharge with it: the network
 * and the routing receive it at the frame-edge cell carrying the most captured flow along the
 * edge, where the captured surface descends into the frame, and the edge beside the entry is
 * not an exit (the network reads the entries for both).
 */
registerCause({
  kind: "river-entry",
  read(state, evidence) {
    evidence.entries.push(...riverEntries(state));
  },
});

function riverEntries(state: RegionalState): Evidence["entries"] {
  const map = state.physical.map,
    mesh = map.mesh,
    entries: Evidence["entries"] = [],
    around = new Int32Array(mesh.stride),
    flow = (i: number) =>
      isContent(mesh, i) && map.WaterKindCodes.get(i) !== 1 && map.RiverOrders.get(i) > 0
        ? Math.max(0, map.FlowAccumulation.get(i))
        : 0;
  // One entry per crossing: the edge cell with the most flow among its edge neighbours.
  const strongest = (i: number) => {
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k],
        other = flow(j);
      if (frameEdge(mesh, j) && (other > flow(i) || (other === flow(i) && j < i))) return false;
    }
    return true;
  };
  for (let i = 0; i < mesh.count; i++)
    if (frameEdge(mesh, i) && flow(i) > 0 && flowsInward(state, i) && strongest(i))
      entries.push({ cell: i, discharge: flow(i) });
  return entries;
}

/** The captured surface descends from the exterior into the frame at this edge cell. */
function flowsInward(state: RegionalState, i: number) {
  const mesh = state.physical.map.mesh,
    h = state.regional.inheritedHeight,
    around = new Int32Array(mesh.stride),
    m = neighborsOf(mesh, i, around);
  let outside = -Infinity,
    inside = Infinity;
  for (let k = 0; k < m; k++) {
    const j = around[k];
    if (!isContent(mesh, j)) outside = Math.max(outside, h.get(j));
    else {
      const { dx, dy } = stepVector(mesh, i, j);
      if (Math.hypot(dx, dy) > 0) inside = Math.min(inside, h.get(j));
    }
  }
  if (outside === -Infinity) return mesh.boundary(i) && inside < h.get(i);
  return outside >= h.get(i) && inside <= h.get(i);
}

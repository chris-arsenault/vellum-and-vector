import { capturedCourses, courseIndex } from "../courses";
import { neighborsOf, regionalSpan } from "../lattice";
import type { RegionalState } from "../state";
import { registerCause } from "./registry";
import { onParentRiver } from "../parentRivers";

/**
 * A captured course is a valley at the parent's scale, not a one-cell trench: its ground is
 * cheaper over a share of the parent span either side, most on the line, so the developed
 * channel wanders within that valley. The parent's channel raster is a weaker corridor.
 */
const courseCorridor = 0.15,
  rasterCorridor = 0.5;
export const courseReachShare = 0.3;

/**
 * A captured river is evidence of where the water runs, not frozen geometry: the network is
 * drawn into its valley, the terrain develops that valley, and the developed stem that
 * follows the course takes its identity (the identity step of the extraction).
 */
registerCause({
  kind: "river",
  read(state, evidence) {
    evidence.courses.push(...capturedCourses(state));
  },
  influence(state, cost) {
    const course = courseWeight(state, courseIndex(state, state.regional.evidence!.courses));
    for (let i = 0; i < cost.length; i++)
      cost[i] *= Math.min(
        1 - (1 - courseCorridor) * course[i],
        onParentRiver(state, i) ? rasterCorridor : 1
      );
  },
});

/** 1 on a captured course, falling off over a share of the parent span beside it. */
function courseWeight(state: RegionalState, owner: Int32Array) {
  const mesh = state.physical.map.mesh,
    n = owner.length,
    span = regionalSpan(state),
    reach = Math.max(2, Math.round((state.regional.parentSpan * courseReachShare) / span)),
    steps = new Int32Array(n).fill(-1),
    queue = new Int32Array(n),
    weight = new Float64Array(n),
    around = new Int32Array(mesh.stride);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (owner[i] >= 0) {
      steps[i] = 0;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const i = queue[read],
      d = steps[i] / reach;
    weight[i] = Math.exp(-2 * d * d);
    if (steps[i] >= reach) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] >= 0) continue;
      steps[j] = steps[i] + 1;
      queue[write++] = j;
    }
  }
  return weight;
}

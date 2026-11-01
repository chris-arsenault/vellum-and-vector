import { generationFeatures } from "../../generationFeatures";
import { cellAt } from "../lattice";
import { repel } from "../network";
import { clamp, type Evidence, type RegionalState } from "../state";
import { registerCause } from "./registry";

/**
 * An inherited summit is a divide node: the network runs around its massif, which is as wide
 * as its prominence suggests, so the developed relief's summit stands where the parent's was.
 * It is read from its captured position every run, so a summit an earlier refinement
 * re-anchored is re-sited from the same evidence. The re-anchoring itself is the identity
 * step of the extraction.
 */
registerCause({
  kind: "peak",
  read(state, evidence) {
    evidence.summits.push(...knownSummits(state));
  },
  influence(state, cost) {
    for (const summit of state.regional.evidence!.summits)
      repel(
        state,
        cost,
        summit.cell,
        clamp(summit.prominence / 1000, 0.25, 1) * state.regional.parentSpan
      );
  },
});

function knownSummits(state: RegionalState): Evidence["summits"] {
  const map = state.physical.map,
    summits: Evidence["summits"] = [];
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (f.kind !== "peak" || f.geometry.type !== "Point") continue;
    const captured = f.attributes.anchoredFrom as [number, number] | undefined,
      [x, y] = captured ?? f.geometry.coordinates,
      cell = cellAt(map.mesh, x, y);
    if (cell < 0 || map.WaterKindCodes.get(cell) === 1) continue;
    summits.push({
      featureId: f.id,
      cell,
      prominence: Number(f.attributes.capturedProminence ?? f.attributes.prominence ?? 300),
      captured: [x, y],
    });
  }
  return summits;
}

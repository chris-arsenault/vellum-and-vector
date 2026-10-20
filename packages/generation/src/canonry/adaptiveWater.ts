import type { GenerationState, MapProcess } from "../process";
import { refineWorkspace, remeshInvalidations, type SamplingSupport } from "./adaptiveWorkspace";
import { physicalFeatureSequence } from "../physicalFeatures";
import type { ResolvedFeatures } from "../features";
import { physicalDistance } from "./physicalMetric";

function valleySupport(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    mesh = map.mesh,
    p = work.profile;
  const size = p.LandformNeighborhoodRadius / work.sampling.featureSamples;
  const supports: SamplingSupport[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const j = map.FlowTargets[i];
    if (j < 0 || map.RiverOrders[i] <= 0) continue;
    const length = physicalDistance(mesh, i, j),
      stations = Math.ceil(length / size);
    for (let n = 0; n <= stations; n++)
      supports.push({
        x: mesh.origin[0] + mesh.x[i] + ((mesh.x[j] - mesh.x[i]) * n) / stations,
        y: mesh.origin[1] + mesh.y[i] + ((mesh.y[j] - mesh.y[i]) * n) / stations,
        radius: size,
        size,
      });
    const drop = (map.Elevation[i] - map.Elevation[j]) / (1024 * length);
    if (drop < p.WaterfallMinimumDrop / p.WaterfallEvaluationLength) continue;
    supports.push({
      x: mesh.origin[0] + mesh.x[i],
      y: mesh.origin[1] + mesh.y[i],
      radius: p.WaterfallEvaluationLength,
      size: p.WaterfallEvaluationLength / work.sampling.featureSamples,
    });
  }
  return supports;
}
export function adaptiveWaterProcess(features: ResolvedFeatures): MapProcess {
  return {
    contract: {
      id: "canonry.refine-water",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:Rivers"],
      produces: [],
      invalidates: [],
      reconciliation: {
        invalidates: remeshInvalidations,
        sequence: [
          ...physicalFeatureSequence("water.runoff", features),
          ...physicalFeatureSequence("water.routing", features),
        ],
        guarantees: [
          "Runoff",
          "Lakes",
          "LakeOutlets",
          "DrainageGuidance",
          "FlowRouting",
          "Rivers",
        ].map((product) => `canonry:${product}`),
      },
      workspaceOnly: true,
    },
    behavior: {
      kind: "transfer",
      async transfer(state, context) {
        if (!refineWorkspace(state, valleySupport(state), "declared")) return;
        // This repeats spatial reconciliation, never geological time or incision.
        await context.reconcile!();
      },
    },
    validate: () => [],
  };
}

import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { refineWorkspace, type SamplingSupport } from "./adaptiveWorkspace";
import { drainageSteps } from "./sequence";
import { applyNativeStep, nativeContracts } from "./contracts";
import { nativeContext } from "./context";
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
function reconcileWater(state: GenerationState, context: MapProcessContext, seed: number) {
  const map = state.physical!.map;
  for (const step of drainageSteps) {
    const c = nativeContext(state, context, seed, step[1]);
    applyNativeStep(map, c, step);
    const contract = nativeContracts[step[0]];
    for (const fact of contract.invalidates) state.facts.delete(`canonry:${fact}`);
    for (const fact of contract.produces) state.facts.add(`canonry:${fact}`);
  }
}
export function adaptiveWaterProcess(seed: number): MapProcess {
  return {
    contract: {
      id: "canonry.refine-water",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:Rivers"],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
    },
    apply(state, context) {
      if (!refineWorkspace(state, valleySupport(state))) return;
      // This repeats spatial reconciliation, never geological time or incision.
      reconcileWater(state, context, seed);
    },
    validate: () => [],
  };
}

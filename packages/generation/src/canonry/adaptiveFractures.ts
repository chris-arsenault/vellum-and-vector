import type { GenerationState } from "../process";
import type { PhysicalContext } from "./context";
import { plannedFractures, applyPlannedFractures } from "./fractures";
import { refineWorkspace, type RemeshInvalidationPolicy } from "./adaptiveWorkspace";

export function prepareAdaptiveFractures(
  state: GenerationState,
  context: PhysicalContext,
  invalidation: RemeshInvalidationPolicy = "standalone"
) {
  const work = state.physical!,
    mesh = work.map.mesh;
  const faults = plannedFractures(work.map, context);
  refineWorkspace(
    state,
    faults.flatMap((fault) =>
      fault.coordinates.map(([x, y]) => ({
        x: x + mesh.origin[0],
        y: y + mesh.origin[1],
        radius: fault.width,
        size: fault.width / work.sampling.featureSamples,
      }))
    ),
    invalidation
  );
  return (map: typeof work.map, c: PhysicalContext) => applyPlannedFractures(map, c, faults);
}

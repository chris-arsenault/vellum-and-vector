import {
  Band,
  createAdaptiveField,
  prepareAdaptiveTransfer,
  resampleChannels,
  gridPosition,
  putChannel,
  type AdaptiveField,
  type AdaptiveLattice,
  type Grid,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { projectionInterpolation, releaseProjection } from "./atlasSampling";

function projectRegular(state: GenerationState, work: AtlasPhysicalWorkspace) {
  const mesh = work.map.mesh,
    grid = state.surface;
  // hpc-exempt: projection cache identity, built once per projection, never per cell.
  const key = JSON.stringify([
    grid.bounds,
    grid.active.length,
    grid.width,
    grid.height,
    mesh.count,
    mesh.spacing,
    mesh.origin,
    mesh.periodic,
  ]);
  work.grid = grid.coverage;
  if (work.interpolation && work.interpolationKey === key) return;
  if (work.interpolation) releaseProjection(work.interpolation);
  work.samples.release();
  work.interpolation = projectionInterpolation(
    mesh,
    grid.active.length,
    (i) => {
      const p = gridPosition(grid, i);
      return [p.x - mesh.origin[0], p.y - mesh.origin[1]];
    },
    grid.coverage
  );
  work.interpolationKey = key;
  work.samples = work.interpolation.samples;
}
export function refreshWorkspaceSamples(
  state: GenerationState,
  work: AtlasPhysicalWorkspace,
  prepared?: ReturnType<typeof prepareAdaptiveTransfer>
) {
  if (!work.map.mesh.topology) {
    projectRegular(state, work);
    return;
  }
  if (work.interpolation) {
    releaseProjection(work.interpolation);
    delete work.interpolation;
    delete work.interpolationKey;
  }
  const previous = state.surface,
    topology = work.map.mesh.topology;
  work.samples.release();
  // The adaptive lattice holds its leaf table resident; the band is a view over it.
  work.samples = Band.over(
    (work.map.mesh as AdaptiveLattice).leafCells(),
    { name: "physical:samples", type: "int32", lifetime: "run" },
    previous.coverage.cache
  );
  work.grid = previous.coverage;
  if (previous.topology === topology) return;
  const next = createAdaptiveField(previous.id, previous.scope, topology, previous.coverage.cache);
  work.grid = next.coverage;
  if (!Object.keys(previous.channels).length) {
    state.surface = next;
    return;
  }
  resampleSurface(previous, next, prepared);
  state.surface = next;
  if (state.domain.world.areas[state.domain.scope.areaId].parentId && work.map.mesh.periodic)
    state.surface.periodicWidth = work.map.mesh.periodic.width;
}
function resampleSurface(
  previous: Grid,
  next: AdaptiveField,
  prepared: ReturnType<typeof prepareAdaptiveTransfer> | undefined
) {
  if (previous.topology?.bounds.every((value, i) => value === next.topology.bounds[i])) {
    const transfer =
      prepared ?? prepareAdaptiveTransfer(previous.topology, next.topology, next.coverage);
    for (const [name, values] of Object.entries(previous.channels)) {
      putChannel(
        next,
        name,
        previous.units[name],
        transfer(values, channelQuantity(previous, name)),
        channelQuantity(previous, name)
      );
    }
  } else resampleChannels(previous, next, undefined);
}
function channelQuantity(grid: Grid, name: string) {
  return (
    grid.quantities?.[name] ??
    (["category", "cell-index"].includes(grid.units[name]) ? "category" : "intensive")
  );
}

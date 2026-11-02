import { gridPosition } from "@atlas/domain";
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
/** Project the map's lattice onto its display surface; a child spanning the seam wraps it. */
export function refreshWorkspaceSamples(state: GenerationState, work: AtlasPhysicalWorkspace) {
  projectRegular(state, work);
  if (state.domain.world.areas[state.domain.scope.areaId].parentId && work.map.mesh.periodic)
    state.surface.periodicWidth = work.map.mesh.periodic.width;
}

import {
  createGrid,
  generateChannel,
  gridPosition,
  fieldInterpolator,
  canonicalPosition,
  rectangle,
  spatial,
  putChannel,
  type RegularGrid,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { atlasChannels } from "./canonry/atlasChannels";
import { nativeIndexAtSurface } from "./canonry/atlasWorkspace";

const previewChannels = new Set(["elevation", "water", "ice", "finalSurface"]);

/** Independent display samples; the live numerical workspace remains owned by generation. */
export function generationPreview(state: GenerationState): RegularGrid {
  const [x0, y0, x1, y1] = state.surface.bounds;
  const longest = Math.max(x1 - x0, y1 - y0);
  const grid = createGrid(
    "generation-preview",
    { ...state.surface.scope, footprint: rectangle(state.surface.bounds) },
    Math.max(2, Math.ceil((127 * (x1 - x0)) / longest) + 1),
    Math.max(2, Math.ceil((127 * (y1 - y0)) / longest) + 1),
    state.surface.bounds
  );
  grid.periodicWidth = state.surface.periodicWidth;
  grid.scope.footprint = state.surface.scope.footprint;
  const covered = spatial.pointCoverage(grid.scope.footprint),
    reference = state.domain.world.reference,
    worldBounds =
      reference.boundaryMode === "cylinder" ? spatial.bounds(reference.domain) : undefined;
  for (let i = 0; i < grid.active.length; i++)
    grid.active.set(
      i,
      covered(canonicalPosition(reference, gridPosition(grid, i), worldBounds)) ? 1 : 0
    );
  if (!state.physical) {
    for (const name of Object.keys(state.surface.channels).filter((name) =>
      previewChannels.has(name)
    )) {
      // The preview mask already establishes coverage; an edge's floating-point
      // representation must not trigger a second, stricter containment check.
      const sample = fieldInterpolator(state.surface, name);
      putChannel(
        grid,
        name,
        state.surface.units[name],
        generateChannel(grid, name, (i) =>
          grid.active.get(i) ? sample(gridPosition(grid, i)) : 0
        ),
        state.surface.quantities?.[name]
      );
    }
    return grid;
  }
  const map = state.physical.map;
  const indexes = Int32Array.from(grid.active, (_, i) => {
    const p = gridPosition(grid, i);
    return nativeIndexAtSurface(state, p.x, p.y);
  });
  indexes.forEach((index, i) => {
    if (index < 0) grid.active.set(i, 0);
  });
  for (const binding of atlasChannels.filter((binding) => previewChannels.has(binding.name))) {
    const datum = binding.datum ? map.BaseSeaLevel : 0;
    const values = generateChannel(grid, binding.name, (n) => {
      const i = indexes[n];
      return i < 0
        ? 0
        : (map[binding.native].get(i) - datum) * binding.scale + (binding.offset ?? 0);
    });
    putChannel(
      grid,
      binding.name,
      binding.unit,
      values,
      binding.unit === "category" ? "category" : "intensive"
    );
  }
  return grid;
}

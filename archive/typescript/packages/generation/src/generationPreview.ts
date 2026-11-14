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
  fieldChannelName,
  channelUnit,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { physicalChannels } from "./world/atlasChannels";
import { nativeIndexAtSurface } from "./world/atlasWorkspace";

const previewChannels = new Set(["Elevation", "WaterKindCodes", "IceThickness", "finalSurface"]);

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
    for (const name of Object.keys(state.surface.channels)
      .map(fieldChannelName)
      .filter((name) => previewChannels.has(name))) {
      // The preview mask already establishes coverage; an edge's floating-point
      // representation must not trigger a second, stricter containment check.
      const sample = fieldInterpolator(state.surface, name);
      putChannel(
        grid,
        name,
        channelUnit(state.surface, name),
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
  for (const binding of physicalChannels.filter((binding) => previewChannels.has(binding.name))) {
    const values = generateChannel(
      grid,
      binding.name,
      (n) => {
        const i = indexes[n];
        return i < 0 ? 0 : map[binding.name].get(i);
      },
      map[binding.name].type
    );
    putChannel(
      grid,
      binding.name,
      binding.unit,
      values,
      binding.unit === "category" ? "category" : "intensive"
    );
  }
  for (const name of ["BaseSeaLevel", "EffectiveSeaLevel"] as const)
    putChannel(
      grid,
      name,
      "native-length",
      generateChannel(grid, name, () => map[name])
    );
  return grid;
}

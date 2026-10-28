import { createGrid, gridPosition, gridSampler, putChannel, type RegularGrid } from "@atlas/domain";
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
    state.surface.scope,
    Math.max(2, Math.ceil((127 * (x1 - x0)) / longest) + 1),
    Math.max(2, Math.ceil((127 * (y1 - y0)) / longest) + 1)
  );
  if (!state.physical) {
    for (const name of Object.keys(state.surface.channels).filter((name) =>
      previewChannels.has(name)
    )) {
      const sample = gridSampler(state.surface, name);
      putChannel(
        grid,
        name,
        state.surface.units[name],
        Float64Array.from(grid.active, (active, i) => (active ? sample(gridPosition(grid, i)) : 0)),
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
    if (index < 0) grid.active[i] = 0;
  });
  for (const binding of atlasChannels.filter((binding) => previewChannels.has(binding.name))) {
    const datum = binding.datum ? map.BaseSeaLevel : 0;
    const values = Float64Array.from(indexes, (i) =>
      i < 0 ? 0 : (map[binding.native].get(i) - datum) * binding.scale + (binding.offset ?? 0)
    );
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

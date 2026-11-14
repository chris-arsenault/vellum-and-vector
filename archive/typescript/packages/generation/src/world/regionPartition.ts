import type { GenerationState } from "../process";

/** Dry land area of the generated map, in square metres. */
export function landArea(state: GenerationState) {
  const map = state.physical!.map;
  let area = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && map.WaterKindCodes.get(i) === 0)
      area += map.mesh.contentArea(i);
  return area;
}

import type { PhysicalField } from "./field";

/** Prevalence follows the occupied share of a map-relative area or coastal length. */
export function areaBudget(budget: number, area: number, referenceArea: number) {
  return budget <= 0 || area <= 0 ? 0 : Math.max(1, Math.round((budget * area) / referenceArea));
}
/** Content area of the cells the predicate accepts. */
export function mediumArea(map: PhysicalField, includes: (i: number) => boolean = () => true) {
  let area = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && includes(i)) area += map.mesh.contentArea(i);
  return area;
}

import type { PhysicalField } from "../world/field";
import { elevationLimit, units } from "../world/math";
import { recordFlow, type FlowCause, type Pool } from "../coupling/flows";
import { buryCover } from "./groundBurial";
import { placeMaterial } from "./groundMaterial";
import {
  facetShare,
  facetSurface,
  moveFacet,
  projectGround,
  type GroundFacet,
} from "./groundShares";
import type { MaterialLayer } from "./rockColumn";
import { groundStorage } from "./groundStorage";

/** Solid emplacement. A selected facet receives local depth; the result is mean cell height. */
export function constructMaterial(
  map: PhysicalField,
  cell: number,
  material: MaterialLayer,
  cause: FlowCause,
  from: Pool,
  only?: GroundFacet
) {
  let built = 0;
  for (const facet of only ? [only] : (["land", "cut"] as const)) {
    const share = facetShare(map, cell, facet),
      depth = Math.min(
        Math.max(0, material.depth),
        Math.max(0, units(elevationLimit) - facetSurface(map, cell, facet))
      );
    if (share <= 0 || depth <= 0) continue;
    buryCover(map, cell, facet);
    placeMaterial(map, cell, facet, { ...material, depth });
    moveFacet(map, cell, facet, depth);
    built += depth * share;
  }
  if (built <= 0) return 0;
  groundStorage(map).SurfaceRockLoad.add(cell, built);
  recordFlow(map, cause, from, "rock", (built / 1024) * map.mesh.area(cell));
  projectGround(map, cell);
  return built;
}

/** Transported fragments keep constituent history but form a new, initially uncemented bed. */
export const depositedMaterial = (material: MaterialLayer, epoch: number): MaterialLayer => ({
  ...material,
  bedSlopeX: 0,
  bedSlopeY: 0,
  deposited: epoch,
  consolidation: 0,
});

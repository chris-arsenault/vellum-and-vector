import type { PhysicalField } from "../world/field";
import { clamp, units } from "../world/math";
import { columnSize, layerDepth, readLayer, setLayer } from "./rockColumn";
import { facetShare, projectGround } from "./groundShares";
import { rockKindOfCode } from "./rockCatalogue";
import { groundStorage } from "./groundStorage";

/** Successive strains reorient surviving beds; crossing strains can reduce directional coherence. */
export function deformGround(
  map: PhysicalField,
  cell: number,
  x: number,
  y: number,
  coherence: number,
  movement: number
) {
  const length = Math.hypot(x, y);
  if (length <= 0 || movement <= 0) return;
  const ux = x / length,
    uy = y / length,
    gx = (ux * ux - uy * uy) * coherence * 1000,
    gy = 2 * ux * uy * coherence * 1000;
  for (const facet of ["land", "cut"] as const) {
    if (facetShare(map, cell, facet) <= 0) continue;
    for (let slot = 0; slot < columnSize(facet); slot++) {
      if (layerDepth(map, cell, slot, facet) <= 0) continue;
      const layer = readLayer(map, cell, slot, facet),
        strain = movement / (movement + Math.max(units(1), layer.depth)),
        jointing = rockKindOfCode(layer.kind).jointing;
      setLayer(
        map,
        cell,
        slot,
        layer.kind,
        layer.depth,
        {
          ...layer,
          grainX: layer.grainX + (gx - layer.grainX) * strain,
          grainY: layer.grainY + (gy - layer.grainY) * strain,
          damage: clamp(layer.damage + strain * jointing, 0, 1),
          altered: map.CompletedEpochCount,
        },
        facet
      );
    }
  }
  projectGround(map, cell);
}
/** Support changes move the existing package and commit its support datum together. */
export function supportedAt(map: PhysicalField, cell: number, support: number, movement: number) {
  groundStorage(map).CrustSupportElevation.set(cell, support);
  groundStorage(map).BedrockElevation.add(cell, movement);
  projectGround(map, cell);
}
/** The support process proposes its load-dependent datum; flexure commits the movement. */
export function setSupportTarget(map: PhysicalField, cell: number, elevation: number) {
  groundStorage(map).CrustSupportTarget.set(cell, elevation);
}

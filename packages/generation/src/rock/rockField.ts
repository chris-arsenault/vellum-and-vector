import type { PhysicalField } from "../world/field";
import { rockResistance, round } from "../world/math";
import { hardestRock, rockCatalogue, softestRock, type RockKindId } from "./rockCatalogue";
import { readLayer, setLayer, changeLayer } from "./rockColumn";
import { facetShare, projectGround } from "./groundShares";

/** All ground starts as ordinary rock. */
export function resetRock(map: PhysicalField) {
  for (let cell = 0; cell < map.mesh.count; cell++)
    setRockStrength(map, cell, rockCatalogue.strata.resistance);
}
/** A map says how strong the rock at a cell is, where it knows no more than that. */
export function setRockStrength(map: PhysicalField, cell: number, strength: number) {
  for (const facet of ["land", "cut"] as const) {
    if (facetShare(map, cell, facet) <= 0) continue;
    const layer = readLayer(map, cell, 0, facet);
    setLayer(
      map,
      cell,
      0,
      layer.kind,
      layer.depth,
      { ...layer, strength: rockResistance(strength), altered: map.CompletedEpochCount },
      facet
    );
  }
  projectGround(map, cell);
}
/** New crust's surface is basalt. */
export function newBasaltSurface(map: PhysicalField, cell: number) {
  changeLayer(map, cell, 0, rockCatalogue.basalt);
  projectGround(map, cell);
}

/** Hardens or softens the rock at a cell in place, within the limits of what rock can be. */
export function alterRock(map: PhysicalField, cell: number, change: number) {
  for (const facet of ["land", "cut"] as const) {
    if (facetShare(map, cell, facet) <= 0) continue;
    const layer = readLayer(map, cell, 0, facet);
    setLayer(
      map,
      cell,
      0,
      layer.kind,
      layer.depth,
      {
        ...layer,
        strength: rockResistance(layer.strength + change),
        altered: map.CompletedEpochCount,
      },
      facet
    );
  }
  projectGround(map, cell);
}
/** Salt fuses the rock it lies on: harder for any scorch, and glass where the bed burnt through. */
export function fuseRock(map: PhysicalField, cell: number, hardening: number, toGlass: boolean) {
  alterRock(map, cell, round(hardening));
  if (!toGlass) return;
  hardenRock(
    map,
    cell,
    "saltGlass",
    Math.max(map.RockResistance.get(cell), rockCatalogue.saltGlass.resistance)
  );
}

/** A process that hardens ground leaves its own rock on the surface, where it is harder than what was. */
export function hardenRock(
  map: PhysicalField,
  cell: number,
  kind: RockKindId,
  resistance: number = rockCatalogue[kind].resistance
) {
  const value = Math.max(softestRock, Math.min(hardestRock, resistance));
  for (const facet of ["land", "cut"] as const) {
    if (facetShare(map, cell, facet) <= 0) continue;
    const old = readLayer(map, cell, 0, facet);
    if (value <= old.strength) continue;
    changeLayer(map, cell, 0, rockCatalogue[kind], facet);
    const changed = readLayer(map, cell, 0, facet);
    setLayer(map, cell, 0, changed.kind, changed.depth, { ...changed, strength: value }, facet);
  }
  projectGround(map, cell);
}

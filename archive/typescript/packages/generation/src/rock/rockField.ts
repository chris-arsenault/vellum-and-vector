import type { PhysicalField } from "../world/field";
import { rockResistance, round } from "../world/math";
import { hardestRock, rockCatalogue, softestRock, type RockKindId } from "./rockCatalogue";
import { readLayer, setLayer, changeLayer, type MaterialLayer } from "./rockColumn";
import { facetShare, projectGround } from "./groundShares";
import { alterGround } from "./groundAlteration";
import { units } from "../world/math";

/** Surface reactions reach a finite skin; buried beds retain their previous properties. */
// length-unit: fraction
const reactionDepth = 0.000035;

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
  if (change === 0) return;
  alterGround(map, cell, {
    depth: units(map.scale.length(reactionDepth)),
    transform: (layer) => ({
      ...layer,
      strength: rockResistance(layer.strength + change),
      altered: map.CompletedEpochCount,
    }),
  });
}
/** Salt fuses the rock it lies on: harder for any scorch, and glass where the bed burnt through. */
export function fuseRock(map: PhysicalField, cell: number, hardening: number, toGlass: boolean) {
  if (hardening === 0 && !toGlass) return;
  alterGround(map, cell, {
    depth: units(map.scale.length(reactionDepth)),
    transform: (layer) => fusedMaterial(layer, round(hardening), toGlass, map.CompletedEpochCount),
  });
}

/** Glass formation is a material change even when the host was already stronger than glass. */
export function fusedMaterial(
  layer: Readonly<MaterialLayer>,
  hardening: number,
  toGlass: boolean,
  epoch: number
): MaterialLayer {
  const strength = rockResistance(layer.strength + hardening);
  return {
    ...layer,
    ...(toGlass
      ? {
          kind: rockCatalogue.saltGlass.code,
          secondaryKind: rockCatalogue.saltGlass.code,
          secondaryShare: 0,
          strength: Math.max(strength, rockCatalogue.saltGlass.resistance),
        }
      : { strength }),
    altered: epoch,
  };
}

/** A process that hardens ground leaves its own rock on the surface, where it is harder than what was. */
export function hardenRock(
  map: PhysicalField,
  cell: number,
  kind: RockKindId,
  resistance: number = rockCatalogue[kind].resistance
) {
  const value = Math.max(softestRock, Math.min(hardestRock, resistance));
  alterGround(map, cell, {
    depth: units(map.scale.length(reactionDepth)),
    transform: (old) =>
      value <= old.strength
        ? old
        : {
            ...old,
            kind: rockCatalogue[kind].code,
            secondaryKind: rockCatalogue[kind].code,
            secondaryShare: 0,
            strength: value,
            altered: map.CompletedEpochCount,
          },
  });
}

import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { facetShare, projectGround, rockSurface, type GroundFacet } from "./groundShares";
import { deepestLayer, readLayer, writeColumn, type MaterialLayer } from "./rockColumn";

/** A captured donor's contact datum and position, in the common world/vertical frames. */
export interface ContactReference {
  x: number;
  y: number;
  land: number;
  cut: number;
}

export type ContactBeds = Readonly<Record<GroundFacet, readonly MaterialLayer[]>>;
export interface ContactPlan {
  cells: readonly number[];
  reference: ContactReference;
  beds: ContactBeds;
}

/** Capture complete material once; preliminary exposure must not replace its own input. */
export function captureContactBeds(map: PhysicalField, cell: number): ContactBeds {
  const read = (facet: GroundFacet) =>
    Array.from({ length: deepestLayer(map, cell, facet) + 1 }, (_, layer) =>
      readLayer(map, cell, layer, facet)
    );
  return { land: read("land"), cut: read("cut") };
}

/**
 * Resolve finite beds inside a captured area from their inclined contacts. Material is
 * allocated from the beds this area already holds; complete records carry their hosted
 * densities and history. Placement is independent of column depth and is not reconstructed.
 */
export function realizeContacts(
  map: PhysicalField,
  cells: readonly number[],
  reference: ContactReference,
  beds = captureContactBeds(map, cells[0])
) {
  // owner-direction(2026-11-12): what is inside a parent cell comes from the rock column, shaped by all the relevant processes.
  for (const facet of ["land", "cut"] as const)
    resolveFacet(map, cells, reference, facet, beds[facet]);
  for (const cell of cells) projectGround(map, cell);
}

function resolveFacet(
  map: PhysicalField,
  cells: readonly number[],
  reference: ContactReference,
  facet: GroundFacet,
  layers: readonly MaterialLayer[]
) {
  const occupied = cells.filter((cell) => facetShare(map, cell, facet) > 0);
  if (!occupied.length) return;
  const last = layers.length - 1;
  if (last === 0) return;
  const areas = Float64Array.from(
      occupied,
      (cell) => map.mesh.area(cell) * facetShare(map, cell, facet)
    ),
    depths = projectedDepths(map, occupied, layers, reference, facet);
  allocateBeds(layers, depths, areas);
  occupied.forEach((cell, at) => {
    const resolved = layers.slice(0, -1).flatMap((layer, bed) => {
      const depth = depths[bed][at];
      return depth > 0 ? [{ ...layer, depth }] : [];
    });
    resolved.push(layers[last]);
    writeColumn(map, cell, facet, resolved);
  });
}

/** A bed's bottom is an inclined plane through the donor's retained contact. */
function projectedDepths(
  map: PhysicalField,
  cells: readonly number[],
  layers: readonly MaterialLayer[],
  reference: ContactReference,
  facet: GroundFacet
) {
  const depths = layers.slice(0, -1).map(() => new Float64Array(cells.length));
  cells.forEach((cell, at) => {
    const dx = map.mesh.x(cell) + map.mesh.origin[0] - reference.x,
      dy = map.mesh.y(cell) + map.mesh.origin[1] - reference.y;
    let top = rockSurface(map, cell, facet),
      contact = reference[facet];
    for (let bed = 0; bed < depths.length; bed++) {
      const layer = layers[bed];
      contact -= layer.depth;
      const bottom = Math.min(
        top,
        contact + MapScale.inUnits(layer.bedSlopeX * dx + layer.bedSlopeY * dy, "native")
      );
      depths[bed][at] = top - bottom;
      top = bottom;
    }
  });
  return depths;
}

/** Finite captured material, not a relief target, limits what each outcrop can receive. */
function allocateBeds(
  layers: readonly MaterialLayer[],
  depths: Float64Array[],
  areas: Float64Array
) {
  const area = areas.reduce((sum, value) => sum + value, 0);
  depths.forEach((values, bed) => {
    const wanted = values.reduce((sum, depth, at) => sum + depth * areas[at], 0),
      available = layers[bed].depth * area;
    // A clipped footprint with no resolved exposure retains its still-latent bed.
    if (!(wanted > 0)) values.fill(layers[bed].depth);
    else for (let at = 0; at < values.length; at++) values[at] *= available / wanted;
  });
}

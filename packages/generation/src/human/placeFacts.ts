import { MapScale, humanLayers } from "@atlas/domain";
import { riverOrderAt } from "../water/riverKeeping";
import type { PhysicalField } from "../world/field";
import type { KnownPlace } from "./placeRegistry";

/**
 * What a place stands on, read from the land under its zone: the facts its record states
 * about its ground. A place is explained by its land, never by a draw.
 */
export interface PlaceLand {
  readonly x: number;
  readonly y: number;
  /** Metres above the sea at its densest cell. */
  readonly metres: number;
  /** The greatest river running through its zone, as the river's order, or 0. */
  readonly river: number;
  /** Whether the sea lies beside its zone. */
  readonly coastal: boolean;
  /** The steepness of the ground at its densest cell, as rise over run. */
  readonly slope: number;
  /** Land under crops and under herds within its zone, and the zone's whole land. */
  readonly farmedKm2: number;
  readonly grazedKm2: number;
  readonly zoneKm2: number;
  /** What kind of site it is, and the sentence that says why people are there. */
  readonly siteKind: "harbour" | "river mouth" | "river" | "pass" | "upland" | "plain";
  readonly siteReason: string;
}
const km2 = (map: PhysicalField, cell: number) =>
  MapScale.areaUnits(map.mesh.area(cell), "m2", "km2");
/** Ground this much steeper than level is hill country to build on. */
const hillSlope = 0.08;

function beside(map: PhysicalField, cell: number, water: number) {
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const next = map.mesh.neighbor(cell, edge);
    if (next >= 0 && map.WaterKindCodes.get(next) === water) return true;
  }
  return false;
}
/** A cell lower than the ground on two opposite sides and higher than the ground between. */
function saddle(map: PhysicalField, cell: number) {
  let above = 0,
    below = 0;
  const here = map.Elevation.get(cell);
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const next = map.mesh.neighbor(cell, edge);
    if (next < 0) continue;
    if (map.Elevation.get(next) > here) above++;
    else below++;
  }
  return above >= 2 && below >= 2 && map.Slope.get(cell) > hillSlope;
}
function site(river: number, coastal: boolean, pass: boolean, hilly: boolean) {
  if (coastal && river > 0)
    return ["river mouth", "where a river meets the sea, with the going of both"] as const;
  if (coastal) return ["harbour", "on the shore, where the sea's going reaches the land"] as const;
  if (river > 0) return ["river", "on a river, where its valley's going gathers"] as const;
  if (pass) return ["pass", "at a crossing of high ground, where the ways over it meet"] as const;
  if (hilly) return ["upland", "in hill country, where its people's land lies around it"] as const;
  return ["plain", "in open country, where the ways across it meet"] as const;
}
export function placeLand(
  map: PhysicalField,
  place: Pick<KnownPlace, "anchor" | "cells">
): PlaceLand {
  const anchor = place.anchor;
  let river = 0,
    coastal = false,
    farmedKm2 = 0,
    grazedKm2 = 0,
    zoneKm2 = 0;
  for (const cell of place.cells.length ? place.cells : [anchor]) {
    river = Math.max(river, riverOrderAt(map, cell));
    coastal ||= beside(map, cell, 1);
    farmedKm2 += map[humanLayers.farmland].get(cell) * km2(map, cell);
    grazedKm2 += map[humanLayers.pasture].get(cell) * km2(map, cell);
    zoneKm2 += km2(map, cell);
  }
  const slope = map.Slope.get(anchor),
    [siteKind, siteReason] = site(river, coastal, saddle(map, anchor), slope > hillSlope);
  return {
    x: map.mesh.origin[0] + map.mesh.x(anchor),
    y: map.mesh.origin[1] + map.mesh.y(anchor),
    metres: MapScale.metres(map.Elevation.get(anchor) - map.EffectiveSeaLevel, "native"),
    river,
    coastal,
    slope,
    farmedKm2,
    grazedKm2,
    zoneKm2,
    siteKind,
    siteReason,
  };
}

import { MapScale } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "../world/field";
import { humanLayersOf } from "./humanLayers";
import { held, traditionFields, type TraditionField } from "./identityReads";
import type { KnownPlace } from "./placeRegistry";
import { traditionOf } from "./traditions";

/**
 * Who lives on a place's ground, read from the identity column under its zone: for each kind
 * of tradition, the share of the place's people who hold each one, by the world entity that
 * names it. A place of many tongues says so; nothing here picks one for it.
 */
export type PlacePeoples = Record<TraditionField, Record<string, number>>;
/** A share of a place's people below this is not told apart. */
const leastShare = 0.01;

export function placePeoples(
  state: GenerationState,
  map: PhysicalField,
  place: Pick<KnownPlace, "anchor" | "cells">
): PlacePeoples {
  const layers = humanLayersOf(map),
    cells = place.cells.length ? place.cells : [place.anchor],
    counted = new Map<TraditionField, Map<number, number>>(
      traditionFields.map((field) => [field, new Map()])
    );
  let everyone = 0;
  for (const cell of cells) {
    const km2 = MapScale.areaUnits(map.mesh.area(cell), "m2", "km2"),
      column = layers.column(cell);
    everyone += layers.people(cell) * km2;
    for (const field of traditionFields) {
      const tally = counted.get(field)!;
      for (const [code, people] of held(column, field))
        tally.set(code, (tally.get(code) ?? 0) + people * km2);
    }
  }
  const shares = (field: TraditionField) =>
    Object.fromEntries(
      [...counted.get(field)!]
        .map(([code, people]) => [traditionOf(state, code)?.entity, people / everyone] as const)
        .filter(([entity, share]) => entity && share >= leastShare)
        .sort((a, b) => b[1] - a[1])
        .map(([entity, share]) => [entity, Math.round(share * 1000) / 1000])
    );
  return Object.fromEntries(
    traditionFields.map((field) => [field, everyone > 0 ? shares(field) : {}])
  ) as PlacePeoples;
}

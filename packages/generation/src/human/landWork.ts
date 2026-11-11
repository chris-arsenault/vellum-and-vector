import { MapScale, humanLayers, type Band } from "@atlas/domain";
import { ask } from "../coupling/answers";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import type { PassFacts } from "./passFacts";
import { passage, reach, type Passage } from "./reach";
import { travelStep } from "./travel";

/** What every step of a pass is given: the land, how it is asked, and how this pass acts. */
export interface LandPass {
  map: PhysicalField;
  context: PhysicalContext;
  facts: PassFacts;
}
/** A pass under way: the going between cells, and the food each cell is brought from others. */
export interface LandWork extends LandPass {
  /** Every step's passage at this pass's range. */
  going: Passage;
  /**
   * Per cell: the reach of the habitable land's own area, in square kilometres. A reach of
   * people or food divided by this is their density over the land around the cell.
   */
  land: Band;
  /** Per cell: people per square kilometre fed by food brought in, less those sent out. */
  imports: Band;
  /** Per cell: the mouths that spare food in reach could feed beyond the hunger in reach. */
  market: Band;
}
/** Dry ground of the map itself, where people can live. */
export const habitable = (map: PhysicalField, cell: number) =>
  map.mesh.membership(cell) === 1 && map.WaterKindCodes.get(cell) === 0;
export const km2 = (map: PhysicalField, cell: number) =>
  MapScale.areaUnits(map.mesh.area(cell), "m2", "km2");
export const people = (map: PhysicalField, cell: number) => map[humanLayers.population].get(cell);
/** What the cell feeds as it is used now, with what it is brought. */
export function fedBy(work: LandWork) {
  const support = ask(work.map, "support", work.context);
  return (cell: number) => support.get(cell) + work.imports.get(cell);
}
/** A band of the map's size for a step's working, zeroed. Release it when the step is done. */
export const working = (map: PhysicalField, name: string) =>
  map.coverage.scratch("float64", `human:${name}`, map.mesh.count);

export function openWork(pass: LandPass): LandWork {
  const { map, context, facts } = pass,
    friction = ask(map, "travelFriction", context),
    going = passage(map, travelStep(map, friction), map.scale.length(facts.range)),
    area = working(map, "area"),
    land = working(map, "land");
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (habitable(map, cell)) area.set(cell, km2(map, cell));
  reach(map, area, land, going);
  map.coverage.release(area);
  return {
    ...pass,
    going,
    land,
    imports: working(map, "imports"),
    market: working(map, "market"),
  };
}
export function closeWork(work: LandWork) {
  work.map.coverage.release(work.going.passed);
  work.map.coverage.release(work.land);
  work.map.coverage.release(work.imports);
  work.map.coverage.release(work.market);
}

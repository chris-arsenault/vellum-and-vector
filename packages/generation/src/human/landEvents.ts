import { requireThat } from "@atlas/domain";
import { ask } from "../coupling/answers";
import { nativeContext } from "../world/context";
import { generationBindings } from "../generationBindings";
import { deadOn, recordEraEvents, recordEvent } from "./eventRegistry";
import { landHazards, type LandHazard } from "./hazardCatalogue";
import { working } from "./landWork";
import { keepHumanLines, wearHumanLayers } from "./layerOperations";
import { frontierWays } from "./placeFrontiers";
import type { KnownPlace } from "./placeRegistry";
import { applyPlaceEvent } from "../poi/poiEffects";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { runOperation } from "../processOperation";
import { mapCommand } from "../processTraits";
import type { PhysicalField } from "../world/field";

/**
 * What befalls a map's places in each human era. Once the era's people, identities and realms
 * have settled, the hunger each place suffered is read from the land; each of the land's
 * hazards may then strike a living place, by the chance its most exposed ground gives over the
 * era's years, taking from the layers there what they give up to it and marking the ground;
 * and a place that changed hands is remembered as besieged.
 */
/** The place's ground a hazard can reach, and the chance in a year of its worst cell. */
function exposure(map: PhysicalField, place: KnownPlace, hazard: LandHazard) {
  let worst = -1,
    yearly = 0;
  const cells: number[] = [];
  for (const cell of place.cells) {
    const chance = hazard.yearly(map, cell);
    if (!(chance > 0)) continue;
    cells.push(cell);
    if (chance > yearly) [worst, yearly] = [cell, chance];
  }
  return { cells, worst, yearly };
}
/** The hazard falls on the exposed ground at this strength; returns those it killed. */
function fall(
  map: PhysicalField,
  place: KnownPlace,
  hazard: LandHazard,
  cells: readonly number[],
  magnitude: number,
  /** Per cell: the share of what strikes that lands. */
  harm: { get(cell: number): number }
) {
  const before = deadOn(map, place),
    intensity = working(map, "struck");
  for (const cell of cells) intensity.set(cell, magnitude * harm.get(cell));
  runOperation(map, wearHumanLayers, { map, mix: hazard.mix, intensity });
  map.coverage.release(intensity);
  return Math.round(deadOn(map, place) - before);
}
function strike(
  state: GenerationState,
  context: MapProcessContext,
  place: KnownPlace,
  era: { id: string; years: number; harm: Float64Array }
) {
  const map = state.physical!.map;
  for (const hazard of landHazards) {
    const { cells, worst, yearly } = exposure(map, place, hazard);
    if (worst < 0 || context.random() >= -Math.expm1(-yearly * era.years)) continue;
    const magnitude = Math.min(1, hazard.severity * (0.5 + context.random() * 1.5)),
      casualties = fall(map, place, hazard, cells, magnitude, {
        get: (cell) => era.harm[cell],
      });
    recordEvent(state, {
      kind: hazard.kind,
      era: era.id,
      place: place.id,
      cell: worst,
      casualties,
      townsfolk: Math.round(place.townPeople),
      magnitude,
      causes: [`${era.id}: ${hazard.cause} ${casualties} died.`],
    });
    applyPlaceEvent(state, { kind: hazard.kind, magnitude, cell: worst });
  }
}
export const humanEvents: MapProcess = {
  contract: {
    id: "human.events",
    version: "1",
    parameters: {},
    requires: ["atlas:workspace"],
    produces: [],
    invalidates: [],
    workspaceOnly: true,
  },
  operation: mapCommand(
    "human.events",
    "event",
    (state: GenerationState, context: MapProcessContext) => {
      requireThat(state.physical, "physical_workspace", "People live on generated land.");
      const map = state.physical.map,
        epoch = context.epochs.at(-1),
        // What a blow takes is read once, as the era left the land: one place's disaster
        // does not change what the next place's takes.
        asked = ask(map, "harm", nativeContext(state, context, 0)),
        harm = Float64Array.from({ length: map.mesh.count }, (_, cell) => asked.get(cell)),
        era = { id: epoch?.id ?? "present", years: epoch?.duration ?? 0, harm },
        town = Number(generationBindings(context).parameters.townThreshold);
      recordEraEvents(state, { map, era: era.id, town }, (place) =>
        strike(state, context, place, era)
      );
      // A frontier is kept at the places it runs between, for as long as the era held it.
      const kept = frontierWays(state, map).flatMap(({ ends }) => ends.map((end) => end.anchor));
      runOperation(map, keepHumanLines, { map, cells: [...new Set(kept)], years: era.years });
    },
    []
  ),
  validate: () => [],
};

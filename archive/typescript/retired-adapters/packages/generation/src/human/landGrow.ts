import { ask } from "../coupling/answers";
import { defineCommand, runOperation } from "../processOperation";
import { compileLayerMix } from "./layerCatalogue";
import { layHumanLayer, wearHumanLayers } from "./layerOperations";
import { fedBy, habitable, people, working, type LandPass, type LandWork } from "./landWork";
import { founders, growthRate, hungerYears } from "./passFacts";

/**
 * Grow: people thicken where the land and what it is brought feed them, and those it cannot
 * feed are gone within a generation. The first people arrive thin over all the wild feeds.
 */
const hunger = compileLayerMix({ starve: 1 });

/** Where nobody lives anywhere, the first people take up the land the wild can feed. */
export const foundPeople = defineCommand(
  "human.land.found",
  "initialize",
  ({ map, context }: LandPass) => {
    for (let cell = 0; cell < map.mesh.count; cell++) if (people(map, cell) > 0) return;
    const wild = ask(map, "wildYield", context);
    runOperation(map, layHumanLayer, {
      map,
      kind: "population",
      amount: { get: (cell) => (habitable(map, cell) ? founders * wild.get(cell) : 0) },
    });
  },
  []
);
export const growPeople = defineCommand(
  "human.land.grow",
  "elapsed",
  (work: LandWork) => {
    const { map, facts } = work;
    if (!facts.grows) return;
    const fed = fedBy(work),
      harm = ask(map, "harm", work.context),
      born = working(map, "born"),
      starved = working(map, "starved"),
      filling = Math.exp(-growthRate * facts.years),
      lasting = Math.exp(-facts.years / hungerYears);
    for (let cell = 0; cell < map.mesh.count; cell++) {
      const living = people(map, cell),
        room = fed(cell);
      if (!(living > 0)) continue;
      // People fill what feeds them along the usual curve of growth into a limit.
      if (living < room) born.set(cell, room / (1 + (room / living - 1) * filling) - living);
      // What a full attack of hunger takes is sized so the unfed are gone in their time.
      else if (living > room)
        starved.set(
          cell,
          -Math.log(1 - ((living - room) * (1 - lasting)) / living) * harm.get(cell)
        );
    }
    runOperation(map, layHumanLayer, { map, kind: "population", amount: born });
    runOperation(map, wearHumanLayers, { map, mix: hunger, intensity: starved });
    map.coverage.release(born);
    map.coverage.release(starved);
  },
  []
);

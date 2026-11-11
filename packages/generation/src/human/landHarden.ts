import { humanLayers } from "@atlas/domain";
import { ask } from "../coupling/answers";
import { defineCommand, runOperation } from "../processOperation";
import { compileLayerMix, fullStandingPerBuiltKm2 } from "./layerCatalogue";
import { layHumanLayer, wearHumanLayers } from "./layerOperations";
import { habitable, people, working, type LandWork } from "./landWork";
import { buildingYears, peoplePerBuiltKm2, worksYears } from "./passFacts";

/**
 * Harden: where people stay they build, and what stays built gathers works. Buildings follow
 * the people they house; a place that has lost its people is more than it needs, and what
 * nobody keeps up falls to ruin.
 */
const unkept = compileLayerMix({ neglect: 1 });

export const hardenPlaces = defineCommand(
  "human.land.harden",
  "elapsed",
  ({ map, facts, context }: LandWork) => {
    if (!facts.builds) return;
    const builders = ask(map, "building", context),
      built = map[humanLayers.builtUp],
      works = map[humanLayers.standing],
      raised = working(map, "raised"),
      empty = working(map, "empty"),
      building = 1 - Math.exp(-facts.years / buildingYears);
    for (let cell = 0; cell < map.mesh.count; cell++) {
      if (!habitable(map, cell)) continue;
      const needed = Math.min(1, people(map, cell) / peoplePerBuiltKm2) * builders.get(cell),
        standing = built.get(cell);
      if (needed > standing) raised.set(cell, (needed - standing) * building);
      else if (standing > 0)
        empty.set(cell, (facts.years / buildingYears) * (1 - needed / standing));
    }
    runOperation(map, layHumanLayer, { map, kind: "builtUp", amount: raised });
    runOperation(map, wearHumanLayers, { map, mix: unkept, intensity: empty });
    // Works accumulate toward what the buildings now standing can hold.
    const gathering = 1 - Math.exp(-facts.years / worksYears);
    for (let cell = 0; cell < map.mesh.count; cell++)
      raised.set(
        cell,
        Math.max(0, built.get(cell) * fullStandingPerBuiltKm2 - works.get(cell)) * gathering
      );
    runOperation(map, layHumanLayer, { map, kind: "standing", amount: raised });
    map.coverage.release(raised);
    map.coverage.release(empty);
  },
  []
);

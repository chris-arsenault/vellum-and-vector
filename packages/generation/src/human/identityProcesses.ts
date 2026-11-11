import { MapScale, requireThat } from "@atlas/domain";
import { generationBindings } from "../generationBindings";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { runOperation } from "../processOperation";
import { mapElapsed } from "../processTraits";
import { nativeContext } from "../world/context";
import { liveIdentities } from "./identityPass";
import { liveRealms } from "./realmPass";
import { passage } from "./reach";
import { goingOn } from "./travel";

/**
 * Identity and allegiance in a map's sequence. In every human era, after people have lived
 * the era on the land, they take up one another's ways; once the era's places are known,
 * realms are founded at them and spread their hold.
 */
const contract = (id: string) => ({
  id,
  version: "1",
  parameters: {},
  requires: ["atlas:workspace"],
  produces: [],
  invalidates: [],
  workspaceOnly: true,
});
/** The travel, as a share of the map scale's reference length, an ordinary seat holds. */
const seatReach = MapScale.length(0.0625);
function setting(state: GenerationState, context: MapProcessContext) {
  requireThat(state.physical, "physical_workspace", "People live on generated land.");
  const map = state.physical.map,
    era = context.epochs.at(-1),
    parameters = generationBindings(context).parameters,
    asking = nativeContext(state, context, 0),
    step = goingOn(map, asking);
  return {
    map,
    asking,
    era,
    parameters,
    step,
    variable: (name: string) => Number(era?.variables[name] ?? 1),
  };
}

export const humanIdentityEra: MapProcess = {
  contract: contract("human.identity-era"),
  operation: mapElapsed(
    "human.identity-era",
    { kind: "epoch", fraction: 1 },
    (state, context, years) => {
      const { map, asking, era, parameters, step, variable } = setting(state, context),
        going = passage(map, step, map.scale.length(Number(parameters.cityReach)));
      try {
        runOperation(map, liveIdentities, {
          state,
          map,
          context: asking,
          step,
          going,
          era: era?.id ?? "present",
          years,
          mobility: variable("mobility") * Number(parameters.culturalMobility),
          founders: Number(parameters.cultureCount),
        });
      } finally {
        map.coverage.release(going.passed);
      }
    },
    []
  ),
  validate: () => [],
};
export const humanRealmEra: MapProcess = {
  contract: contract("human.realm-era"),
  operation: mapElapsed(
    "human.realm-era",
    { kind: "epoch", fraction: 1 },
    (state, context, years) => {
      const { map, asking, era, parameters, step, variable } = setting(state, context);
      runOperation(map, liveRealms, {
        state,
        map,
        context: asking,
        step,
        era: era?.id ?? "present",
        years,
        reach: map.scale.resolveMeasure(seatReach) * Number(parameters.politicalReach),
        capacity: variable("politicalCapacity"),
        realms: Number(parameters.polityCount),
      });
    },
    []
  ),
  validate: () => [],
};
export const humanIdentityProcesses = [humanIdentityEra, humanRealmEra];

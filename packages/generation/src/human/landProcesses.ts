import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { runOperation } from "../processOperation";
import { mapCommand, mapElapsed } from "../processTraits";
import { nativeContext } from "../world/context";
import { meetLand, watchLand } from "./landHistory";
import { advanceHumanLand } from "./landPass";
import { loosePass, passesFor, settledPass } from "./passFacts";

/**
 * People's passes in a map's sequence. Inside every geological epoch the land is looked at
 * before its processes run, and afterwards people meet what the epoch did to their ground and
 * live one loose pass on it. Each human era then lives its years on the finished land as
 * settled passes. Nothing is deleted between epochs: the layers ride the crust and go on.
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
/** A loose pass stands for this many years of moving with the wild, whatever the epoch's span. */
const looseYears = 200;
const landOf = (state: GenerationState) => {
  requireThat(state.physical, "physical_workspace", "People live on generated land.");
  return state.physical.map;
};
const validate = () => [];

export const humanLandWatch: MapProcess = {
  contract: contract("human.land-watch"),
  operation: mapCommand(
    "human.land-watch",
    "event",
    (state) => {
      const map = landOf(state);
      runOperation(map, watchLand, { map });
    },
    []
  ),
  validate,
};
export const humanLandEpoch: MapProcess = {
  contract: contract("human.land-epoch"),
  operation: mapCommand(
    "human.land-epoch",
    "event",
    (state: GenerationState, context: MapProcessContext) => {
      const map = landOf(state);
      runOperation(map, meetLand, { map });
      runOperation(map, advanceHumanLand, {
        map,
        context: nativeContext(state, context, 0),
        facts: loosePass(looseYears),
      });
    },
    []
  ),
  validate,
};
export const humanLandEra: MapProcess = {
  contract: contract("human.land-era"),
  operation: mapElapsed(
    "human.land-era",
    { kind: "epoch", fraction: 1 },
    (state, context, years) => {
      const map = landOf(state),
        passes = passesFor(years),
        mobility = Number(context.epochs.at(-1)?.variables.mobility ?? 1);
      runOperation(map, meetLand, { map });
      for (let pass = 0; pass < passes; pass++)
        runOperation(map, advanceHumanLand, {
          map,
          context: nativeContext(state, context, 0),
          facts: settledPass(years / passes, mobility),
        });
    },
    []
  ),
  validate,
};
export const humanLandProcesses = [humanLandWatch, humanLandEpoch, humanLandEra];

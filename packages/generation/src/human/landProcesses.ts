import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { runOperation } from "../processOperation";
import { mapCommand, mapElapsed } from "../processTraits";
import { nativeContext } from "../world/context";
import { generationBindings } from "../generationBindings";
import { craftsPractised } from "./craftCatalogue";
import { recordEraPlaces } from "./eraPlaces";
import { meetLand, watchLand } from "./landHistory";
import { advanceHumanLand } from "./landPass";
import { forgetHumanGround } from "./layerOperations";
import { keptPass, loosePass, passesFor, settledPass, type PassFacts } from "./passFacts";

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
    (state, context) => {
      const map = landOf(state);
      // The epoch about to be lived is far longer than any way or kept line is remembered.
      runOperation(map, forgetHumanGround, { map, years: context.epochs[0]?.duration ?? 0 });
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
/** People meet the land as it now stands: what water covers and ice scours is lost to them. */
export function meetPresentLand(state: GenerationState) {
  const map = landOf(state);
  runOperation(map, meetLand, { map });
}
function live(state: GenerationState, context: MapProcessContext, facts: PassFacts) {
  const map = landOf(state);
  runOperation(map, advanceHumanLand, { map, context: nativeContext(state, context, 0), facts });
}
/** One pass of settled people on a map's land as it stands, for the years it stands for. */
export const liveSettledPass = (
  state: GenerationState,
  context: MapProcessContext,
  years: number,
  mobility: number
) => live(state, context, settledPass(years, mobility));
/** One pass of the people a map was given by a coarser one: they settle its land and stay as many. */
export const liveKeptPass = (state: GenerationState, context: MapProcessContext, years: number) =>
  live(state, context, keptPass(years));
/**
 * The places a stretch of years leaves on a map: its dense zones matched to the places
 * already known, with the country and ways around them, by the map's own settings.
 */
export function recordLandPlaces(
  state: GenerationState,
  context: MapProcessContext,
  stretch: { era: string; years: number; least: number; town?: number }
) {
  const map = landOf(state),
    parameters = generationBindings(context).parameters;
  recordEraPlaces(state, {
    map,
    context: nativeContext(state, context, 0),
    ...stretch,
    range: map.scale.length(Number(parameters.cityReach)),
    roadTravellers: Number(parameters.roadTraffic),
  });
}
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
        liveSettledPass(state, context, years / passes, mobility);
      context.progress(1, `Crafts practised, in cells: ${craftsPractised(map)}`);
    },
    []
  ),
  validate,
};
/**
 * The places an era leaves: the dense zones of the land as it now stands, matched to the
 * places already known, so a town keeps its name through the eras it lives in.
 */
export const humanPlaces: MapProcess = {
  contract: contract("human.places"),
  operation: mapCommand(
    "human.places",
    "event",
    (state: GenerationState, context: MapProcessContext) => {
      const era = context.epochs.at(-1);
      recordLandPlaces(state, context, {
        era: era?.id ?? "present",
        years: era?.duration ?? 0,
        least: Number(generationBindings(context).parameters.townThreshold),
      });
    },
    []
  ),
  validate,
};
export const humanLandProcesses = [humanLandWatch, humanLandEpoch, humanLandEra, humanPlaces];

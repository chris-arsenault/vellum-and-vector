import type { MapProcessContext } from "../process";
import {
  mapCommand,
  mapQuery,
  mapWork,
  processOwner,
  type MapOperation,
  type MapInput,
} from "../processTraits";
import { runOperation, readOperation, type Query } from "../processOperation";
import { oceanMemory } from "../processes/climateProcesses";
import { requireRegional } from "./state";
import { nativeContext, physicalContext } from "../world/context";
import { finalCheck, landforms as physicalLandforms } from "../processes/waterProcesses";
import { conjoinFeatures, readEvidence, respondFeatures, supportFeatures } from "./causes/index";
import { deriveCharacter } from "./character";
import { respondClimate } from "./climate";
import { divides } from "./divides";
import { routeWater, refreshRegionalOcean } from "./drainage";
import { clearRegionalProducts } from "./extraction/features";
import { carryIdentities } from "./extraction/identity";
import { prepareEcology, respondEcology, presentEcology } from "./ecology";
import { mapMagic, respondMagic, reactRegionalMagic, respondRegionalOrganic } from "./magic/index";
import { transportRetainedMagic } from "../world/magicStocks";
import { exchangeMagicWater } from "../world/magicGroundwater";
import { growNetwork } from "./network";
import { extractPlaces, livePeople, preparePeople } from "./people";
import { deriveRelief, updateSlopes } from "./relief";
import { deriveMedia } from "./sharedMedia";
import { ledgerCeilings, ledgerFloors } from "../coupling/fieldContributions";
import { registerCatalogueCauses } from "../poi/poiCauses";
import { declarePlaceEffects } from "../poi/poiEffects";
import { carryPlaces } from "../poi/poiPublish";
import { markPoiLandforms } from "../poi/poiLandforms";
import { describeNativeStep, fieldProduct } from "../world/physicalSteps";
import { routingSteps, nativeSteps } from "../world/sequence";
import type { RegionalState } from "./state";

export interface ScheduledStep {
  id: string;
  message: string;
  produces?: string[];
  operation: MapOperation;
}
/** Local response exposure; these rounds do not append world history. */
export const developmentExposure = [250, 60, 20] as const;
export const rounds = developmentExposure.length;
type RegionalRead = (state: RegionalState, context: MapProcessContext) => void;
const read = (id: string, apply: RegionalRead, dependencies: readonly Query<MapInput>[]) =>
  mapQuery(
    `refinement.${id}`,
    (state, context) => apply(requireRegional(state), context),
    dependencies
  );
const command = (
  id: string,
  kind: "initialize" | "event" | "publish",
  apply: RegionalRead,
  dependencies: readonly Query<MapInput>[]
) =>
  mapCommand(
    `refinement.${id}`,
    kind,
    (state, context) => apply(requireRegional(state), context),
    dependencies
  );

const ocean = read("ocean", refreshRegionalOcean, []);
const media = read(
  "media",
  (state) => {
    updateSlopes(state);
    deriveMedia(state);
  },
  [ocean]
);
// Magic reads the preceding atmospheric state; climate then responds to that forcing.
// This is the existing ordered feedback, not a recursive climate/magic fixed-point solver.
const magic = read("magic-refresh", respondMagic, [media]);
const climate = read("climate", respondClimate, [media, magic]);
export const regionalAtmosphere = climate;
const water = read("water", routeWater, [climate]);
const habitats = read("ecology-present", presentEcology, [climate, water]);
const landforms = read("landforms", classifyLandforms, [media, water]);

/** Each owner supplies an executable operation, never flags interpreted as a lifecycle. */
export const regionalOperations: ScheduledStep[] = [
  {
    id: "clear-products",
    message: "Removing earlier local products",
    operation: command("clear-products", "publish", clearRegionalProducts, []),
  },
  {
    id: "context",
    message: "Reading captured structure and named geography",
    operation: command("context", "initialize", prepareContext, []),
  },
  {
    id: "round",
    message: "Beginning local development",
    operation: command(
      "round",
      "event",
      (state, context) => {
        state.regional.round = Number(context.parameters.round);
        if (state.regional.round === 2) conjoinFeatures(state);
      },
      []
    ),
  },
  {
    id: "relief",
    message: "Developing relief through retained material",
    operation: command("relief", "initialize", deriveRelief, []),
  },
  {
    id: "water",
    message: "Routing present regional water",
    produces: routingProducts(),
    operation: water,
  },
  {
    id: "ocean",
    message: "Resolving the current shoreline",
    produces: describeNativeStep(nativeSteps.oceanConnectivity).writes.map(fieldProduct),
    operation: ocean,
  },
  {
    id: "ocean-memory",
    message: "Updating retained coastal water",
    operation: command(
      "ocean-memory",
      "event",
      (state, context) => {
        runOperation(state.physical.map, oceanMemory.operation, {
          map: state.physical.map,
          context: nativeContext(state, context, 0),
        });
      },
      [ocean]
    ),
  },
  { id: "media", message: "Reading the current terrain", operation: media },
  {
    id: "climate",
    message: "Developing captured climate on local terrain",
    produces: (
      ["Temperature", "Rainfall", "Snowfall", "Moisture", "WindX", "WindY", "Seasonality"] as const
    ).map(fieldProduct),
    operation: climate,
  },
  { id: "magic-refresh", message: "Reading magic through current carriers", operation: magic },
  {
    id: "magic-react",
    message: "Developing inherited magical material",
    operation: mapWork(
      "refinement.magic-react",
      () => 1,
      (state, _context, exposure) => reactRegionalMagic(requireRegional(state), exposure),
      [magic]
    ),
  },
  {
    id: "magic-transport",
    message: "Moving retained material through current carriers",
    operation: command("magic-transport", "event", transportRetainedMagic, [water]),
  },
  {
    id: "magic-water",
    message: "Carrying dissolved material with groundwater",
    operation: command(
      "magic-water",
      "event",
      (state) => runOperation(processOwner(state), exchangeMagicWater, state),
      [water]
    ),
  },
  {
    id: "magic-organic",
    message: "Carrying magic in organic material",
    operation: command("magic-organic", "event", respondRegionalOrganic, []),
  },
  {
    id: "ecology-initialize",
    message: "Reading inherited living communities",
    operation: command("ecology-initialize", "initialize", prepareEcology, []),
  },
  {
    id: "ecology-develop",
    message: "Developing local habitats",
    operation: mapWork(
      "refinement.ecology-develop",
      (state) => developmentExposure[requireRegional(state).regional.round - 1] ?? 0,
      (state, context, exposure) =>
        respondEcology(requireRegional(state), exposure, context, 1 / rounds),
      [climate, water]
    ),
  },
  { id: "ecology-present", message: "Classifying current habitats", operation: habitats },
  {
    id: "place-effects",
    message: "Resolving existing works on current ground",
    operation: command("place-effects", "event", placeEffects, [climate, water]),
  },
  {
    id: "refresh",
    message: "Checking developed geography for publication",
    produces: ["atlas:validated"],
    operation: read(
      "refresh",
      (state, context) => {
        readOperation(state.physical.map, finalCheck.operation, {
          map: state.physical.map,
          context: nativeContext(state, context, 0),
        });
      },
      [landforms, habitats]
    ),
  },
  { id: "landforms", message: "Reading local landforms", operation: landforms },
  {
    id: "magic-map",
    message: "Classifying magical geography",
    operation: command("magic-map", "publish", mapMagic, [magic, climate, water]),
  },
  {
    id: "identity",
    message: "Resolving captured identities",
    operation: command(
      "identity",
      "publish",
      (state) => {
        carryIdentities(state);
        carryPlaces(state);
      },
      [landforms]
    ),
  },
  {
    id: "places",
    message: "Publishing local places and ways",
    operation: command("places", "publish", extractPlaces, [habitats, water]),
  },
];

function prepareContext(state: RegionalState) {
  registerCatalogueCauses();
  state.regional.character = deriveCharacter(state);
  preparePeople(state);
  readEvidence(state);
  growNetwork(state);
  supportFeatures(state);
}

function placeEffects(state: RegionalState, context: MapProcessContext) {
  const applied = state.regional.contributions;
  applied.begin();
  // The round's people live on the ground the round developed, before places act on it.
  if (context.parameters.people) livePeople(state, context);
  declarePlaceEffects(state, applied);
  applied.commit(state.physical.map, ledgerFloors, ledgerCeilings);
  respondFeatures(state);
}

function routingProducts() {
  return [...new Set(routingSteps.flatMap((step) => describeNativeStep(step).writes))].map(
    fieldProduct
  );
}

function classifyLandforms(state: RegionalState) {
  const work = state.physical,
    divide = divides(state);
  for (let i = 0; i < divide.length; i++) work.map.RidgeInfluence.set(i, divide[i]);
  readOperation(work.map, physicalLandforms.operation, {
    map: work.map,
    context: physicalContext(state.regional.input.seed, 0, work.profile),
  });
  markPoiLandforms(state);
}

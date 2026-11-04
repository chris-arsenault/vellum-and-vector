import type { MapProcessContext } from "../process";
import { physicalContext } from "../canonry/context";
import { landformClassification } from "../canonry/landforms";
import { conjoinFeatures, readEvidence, respondFeatures, supportFeatures } from "./causes/index";
import { deriveCharacter, measureGrain } from "./character";
import { respondClimate } from "./climate";
import { divides } from "./divides";
import { routeWater } from "./drainage";
import { erodeRegion } from "./erosion";
import { clearRegionalProducts } from "./extraction/features";
import { carryIdentities } from "./extraction/identity";
import { prepareEcology, respondEcology } from "./ecology";
import { mapMagic, respondMagic } from "./magic/index";
import { growNetwork } from "./network";
import {
  extractPlaces,
  placesEnabled,
  preparePlaces,
  proposePlaces,
  supportProposals,
} from "./places";
import { deriveRelief, updateSlopes } from "./relief";
import { deriveMedia, openFractures } from "./sharedMedia";
import { declareFields } from "./society";
import { ledgerCeilings, ledgerFloors } from "./media";
import { registerCatalogueCauses } from "../poi/poiCauses";
import { declarePlaceEffects } from "../poi/poiEffects";
import { carryPlaces } from "../poi/poiPublish";
import { markPoiLandforms } from "../poi/poiLandforms";
import type { RegionalState } from "./state";

export interface ScheduledStep {
  id: string;
  message: string;
  /** A step that writes features rather than the workspace. */
  publishes?: boolean;
  run(state: RegionalState, context?: MapProcessContext): void;
}

export const rounds = 3;
/** Relief change (m) at any cell below which magic's follow-up reroute waits for the next round. */
const reliefFollowUp = 0.5;

/** Which domains this run develops; the schedule's gates. */
interface Domains {
  physical: boolean;
  magic: boolean;
  geography: boolean;
  society: boolean;
}
function domainsOf(domains: string[]): Domains {
  const physical = domains.includes("physical"),
    magic = domains.includes("magic");
  return { physical, magic, geography: physical || magic, society: placesEnabled(domains) };
}

/**
 * The fixed coupled realization schedule (spec 7): context once, three rounds in a declared
 * order, one final refresh. The network is grown once in round one; every round derives the
 * relief from it through the media as they are then, routes water, evaluates climate and
 * magic, develops the living landscape and settles places. A round is not an epoch; the
 * schedule ends after round three and the refresh. Magic's relief changes trigger the one
 * declared follow-up read (routing) inside the round that made them. The world's projection
 * and extraction follow (`workflow.ts`), then the regional identity and place steps.
 */
export function regionalSchedule(domains: string[]): ScheduledStep[] {
  const d = domainsOf(domains),
    steps: ScheduledStep[] = [
      {
        id: "clear-products",
        message: "Removing this map's earlier products",
        publishes: true,
        run: clearRegionalProducts,
      },
      contextStep(d),
    ];
  for (let round = 1; round <= rounds; round++) steps.push(...roundSteps(d, round));
  steps.push({
    id: "refresh",
    message: "Refreshing derived reads after the last changes",
    run(state) {
      state.regional.round = rounds + 1;
      updateSlopes(state);
      routeWater(state);
      // The water was routed afresh: the features' responses on it (reservoirs, seats) too.
      respondFeatures(state);
      // A seat that settled on new ground graded it: the slopes read from here include that.
      updateSlopes(state);
      deriveMedia(state);
      respondClimate(state);
      if (d.geography) respondEcology(state);
      classifyLandforms(state);
    },
  });
  if (d.physical)
    steps.push({
      id: "descendant-context",
      message: "Recording this map's organization for its own refinement",
      run: publishDescendantContext,
    });
  return steps;
}

/** After the world has published the field's geography: what only a refinement knows. */
export function regionalExtraction(domains: string[]): ScheduledStep[] {
  const d = domainsOf(domains),
    steps: ScheduledStep[] = [
      {
        id: "magic-map",
        message: "Classifying magical geography",
        publishes: true,
        run: mapMagic,
      },
      { id: "features", message: "Publishing the developed geography", publishes: true, run() {} },
      {
        id: "identity",
        message: "Carrying captured identities onto the developed geography",
        publishes: true,
        run(state) {
          carryIdentities(state);
          carryPlaces(state);
        },
      },
    ];
  if (d.society)
    steps.push({
      id: "places",
      message: "Placing villages and local ways",
      publishes: true,
      run: extractPlaces,
    });
  return steps;
}

function contextStep(d: Domains): ScheduledStep {
  return {
    id: "context",
    message: "Reading the captured country's character and established geography",
    run(state) {
      registerCatalogueCauses();
      state.regional.character = deriveCharacter(state);
      if (d.geography) prepareEcology(state);
      preparePlaces(state);
      readEvidence(state);
      if (!d.physical) {
        updateSlopes(state);
        return;
      }
      // The fracture set steers the network's cost; the other media follow each round's water.
      openFractures(state);
      growNetwork(state);
      supportFeatures(state);
    },
  };
}

function roundSteps(d: Domains, round: number): ScheduledStep[] {
  const label = ["broad organization", "coupled responses", "local consequences"][round - 1],
    steps: ScheduledStep[] = [
      {
        id: `round-${round}/structure`,
        message: `Round ${round}: deriving relief from the network (${label})`,
        run(state) {
          state.regional.round = round;
          if (d.physical) deriveRelief(state);
          // The last round's ground is worked by the world's erosion at this map's scale.
          if (d.physical && round === rounds) erodeRegion(state);
          if (round === 2) conjoinFeatures(state);
        },
      },
      {
        id: `round-${round}/water`,
        message: `Round ${round}: routing water and access`,
        run(state) {
          routeWater(state);
          respondFeatures(state);
          deriveMedia(state);
        },
      },
      {
        id: `round-${round}/environment`,
        message: `Round ${round}: evaluating climate and magic on the shared media`,
        run(state) {
          // One ledger cycle per round: climate, magic and society declare their totals
          // against the captured ground; one commit writes the change since the last round.
          const applied = state.regional.contributions;
          applied.begin();
          respondClimate(state);
          if (d.magic) respondMagic(state);
          if (d.society) declareFields(state);
          declarePlaceEffects(state, applied);
          const changed = applied.commit(state.physical.map, ledgerFloors, ledgerCeilings);
          // The one declared follow-up: relief magic changed by a resolvable amount reroutes
          // water before the living landscape and places read it.
          if ((changed.get("Elevation") ?? 0) >= reliefFollowUp * 1024) {
            updateSlopes(state);
            routeWater(state);
            deriveMedia(state);
          }
        },
      },
    ];
  if (d.geography)
    steps.push({
      id: `round-${round}/cover`,
      message: `Round ${round}: developing the living landscape`,
      run: (state) => respondEcology(state),
    });
  if (d.society && round >= 2)
    steps.push({
      id: `round-${round}/places`,
      message:
        round === 2
          ? "Round 2: proposing local places at the network's events"
          : "Round 3: supporting the proposed places",
      run: (state) => (round === 2 ? proposePlaces(state) : supportProposals(state)),
    });
  return steps;
}

/**
 * The world's landform classes on the developed field, read by its peak and range extraction.
 * The classifier reads ridges and passes where tectonics raised a ridge; on a region that
 * mark is the drainage divide between the routed channels.
 */
function classifyLandforms(state: RegionalState) {
  const work = state.physical,
    divide = divides(state);
  for (let i = 0; i < divide.length; i++) work.map.RidgeInfluence.set(i, divide[i]);
  landformClassification(work.map, physicalContext(state.regional.input.seed, 0, work.profile));
  markPoiLandforms(state);
}

/**
 * The child's compact context for its descendants (spec 8.3): the developed grain, measured
 * from the realized relief and carrying the inherited organization where it still holds,
 * written to the field's grain bands so the projection publishes it.
 */
function publishDescendantContext(state: RegionalState) {
  const map = state.physical.map,
    n = map.mesh.count,
    measuredX = new Float64Array(n),
    measuredY = new Float64Array(n),
    character = state.regional.character!;
  measureGrain(state, (i) => map.Elevation.get(i) / 1024, measuredX, measuredY);
  for (let i = 0; i < n; i++) {
    const x = 0.5 * character.grainX[i] + 0.5 * measuredX[i],
      y = 0.5 * character.grainY[i] + 0.5 * measuredY[i],
      coherence = Math.hypot(x, y),
      scale = coherence > 1 ? 1 / coherence : 1;
    map.StructuralGrainX.set(i, Math.round(x * scale * 1000));
    map.StructuralGrainY.set(i, Math.round(y * scale * 1000));
  }
}

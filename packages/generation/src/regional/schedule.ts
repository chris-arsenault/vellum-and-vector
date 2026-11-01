import { deriveCharacter, measureGrain } from "./character";
import { respondClimate } from "./climate";
import { routeWater } from "./drainage";
import { readEvidence } from "./evidence";
import { extractHabitats } from "./extraction/habitats";
import { extractLandforms } from "./extraction/landforms";
import { extractMagicPlaces } from "./extraction/magic";
import { extractWaterGeometry } from "./extraction/water";
import { respondCover } from "./living";
import { respondMagic } from "./magic/index";
import { growNetwork } from "./network";
import {
  extractPlaces,
  placesEnabled,
  preparePlaces,
  proposePlaces,
  supportProposals,
} from "./places";
import { deriveRelief, ensureSurfaceChannels, updateSlopes } from "./relief";
import { drawChannelsToSeats, settleSeats } from "./seats";
import { channel, type RegionalState } from "./state";

export interface ScheduledStep {
  id: string;
  message: string;
  run(state: RegionalState): void;
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
  return {
    physical,
    magic,
    geography: physical || magic,
    society: placesEnabled({ input: { domains } } as RegionalState),
  };
}

/**
 * The fixed coupled realization schedule (spec 7): context once, three rounds in a declared
 * order, one final refresh, one extraction. The network is grown once in round one; every
 * round derives the relief from it through the media as they are then, routes water,
 * evaluates climate and magic, develops the living landscape and settles places. A round is
 * not an epoch; the schedule ends after round three and the refresh. Magic's relief changes
 * trigger the one declared follow-up read (routing) inside the round that made them.
 */
export function regionalSchedule(domains: string[]): ScheduledStep[] {
  const d = domainsOf(domains),
    steps: ScheduledStep[] = [contextStep(d)];
  for (let round = 1; round <= rounds; round++) steps.push(...roundSteps(d, round));
  steps.push({
    id: "refresh",
    message: "Refreshing derived reads after the last changes",
    run(state) {
      state.round = rounds + 1;
      updateSlopes(state);
      routeWater(state);
      respondClimate(state);
      if (d.geography) respondCover(state);
    },
  });
  return [...steps, ...extractionSteps(d)];
}

function contextStep(d: Domains): ScheduledStep {
  return {
    id: "context",
    message: "Reading the captured country's character and established geography",
    run(state) {
      ensureSurfaceChannels(state);
      state.character = deriveCharacter(state);
      preparePlaces(state);
      readEvidence(state);
      if (!d.physical) {
        updateSlopes(state);
        return;
      }
      growNetwork(state);
      drawChannelsToSeats(state);
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
          state.round = round;
          if (d.physical) deriveRelief(state);
        },
      },
      {
        id: `round-${round}/water`,
        message: `Round ${round}: routing water and access`,
        run(state) {
          routeWater(state);
          if (d.society && d.physical) settleSeats(state);
        },
      },
      {
        id: `round-${round}/environment`,
        message: `Round ${round}: evaluating climate and magic on the shared media`,
        run(state) {
          respondClimate(state);
          if (!d.magic) return;
          // The one declared follow-up: relief magic changed by a resolvable amount reroutes
          // water before the living landscape and places read it.
          const changed = respondMagic(state);
          if ((changed.get("elevation") ?? 0) >= reliefFollowUp) {
            updateSlopes(state);
            routeWater(state);
          }
        },
      },
    ];
  if (d.geography)
    steps.push({
      id: `round-${round}/cover`,
      message: `Round ${round}: developing the living landscape`,
      run: (state) => respondCover(state),
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

function extractionSteps(d: Domains): ScheduledStep[] {
  const steps: ScheduledStep[] = [];
  if (d.geography)
    steps.push(
      {
        id: "landforms",
        message: "Naming summits, cols, ranges and valleys",
        run: extractLandforms,
      },
      {
        id: "water-geometry",
        message: "Drawing shores, lakes and rivers",
        run: extractWaterGeometry,
      }
    );
  if (d.magic)
    steps.push({
      id: "magic-places",
      message: "Classifying magical geography",
      run: extractMagicPlaces,
    });
  if (d.geography)
    steps.push({ id: "habitats", message: "Outlining named habitats", run: extractHabitats });
  if (d.society)
    steps.push({ id: "places", message: "Placing villages and local ways", run: extractPlaces });
  if (d.physical)
    steps.push({
      id: "descendant-context",
      message: "Recording this map's organization for its own refinement",
      run: publishDescendantContext,
    });
  return steps;
}

/**
 * The child's compact context for its descendants (spec 8.3): the developed grain, measured
 * from the realized relief and carrying the inherited organization where it still holds.
 */
function publishDescendantContext(state: RegionalState) {
  const g = state.surface,
    n = g.active.length,
    measuredX = new Float64Array(n),
    measuredY = new Float64Array(n),
    outX = channel(state, "structuralGrainX", "ratio"),
    outY = channel(state, "structuralGrainY", "ratio"),
    character = state.character!;
  measureGrain(state, g.channels.elevation, measuredX, measuredY);
  for (let i = 0; i < n; i++) {
    const x = 0.5 * character.grainX[i] + 0.5 * measuredX[i],
      y = 0.5 * character.grainY[i] + 0.5 * measuredY[i],
      coherence = Math.hypot(x, y);
    outX.set(i, coherence > 1 ? x / coherence : x);
    outY.set(i, coherence > 1 ? y / coherence : y);
  }
}

import { deriveCharacter, measureGrain } from "./character";
import { capturedCourses } from "./courses";
import { respondClimate } from "./climate";
import { routeWater } from "./drainage";
import { extractHabitats } from "./extraction/habitats";
import { extractLandforms } from "./extraction/landforms";
import { extractMagicPlaces } from "./extraction/magic";
import { extractWaterGeometry } from "./extraction/water";
import { respondCover } from "./living";
import { respondMagic } from "./magic/index";
import { extractPlaces, placesEnabled, respondPlaces } from "./places";
import { channel, type RegionalState } from "./state";
import { applySupports } from "./supports";
import {
  developTerrain,
  ensureTerrainChannels,
  fillRegionalPits,
  prepareTerrain,
  terrainRounds,
  updateSlopes,
} from "./terrain";

export interface ScheduledStep {
  id: string;
  message: string;
  run(state: RegionalState): void;
}

/** Relief change (m) at any cell below which magic's follow-up reroute waits for the next round. */
const reliefFollowUp = 0.5;

/**
 * The fixed coupled realization schedule (spec 7): context once, three rounds in a declared
 * order, one final refresh, one extraction. A round is not an epoch; the schedule ends after
 * round three and the refresh. Magic's relief changes trigger the one declared follow-up
 * read (pits and routing) inside the round that made them.
 */
export function regionalSchedule(domains: string[]): ScheduledStep[] {
  const physical = domains.includes("physical"),
    magic = domains.includes("magic"),
    geography = physical || magic,
    society = placesEnabled({ input: { domains } } as RegionalState),
    steps: ScheduledStep[] = [];
  steps.push({
    id: "context",
    message: "Reading the captured country's character and established geography",
    run(state) {
      state.character = deriveCharacter(state);
      state.courses = capturedCourses(state);
      if (physical) prepareTerrain(state);
      else {
        ensureTerrainChannels(state);
        updateSlopes(state);
      }
    },
  });
  for (let round = 1; round <= terrainRounds.length; round++) {
    const label = ["broad organization", "coupled responses", "local consequences"][round - 1];
    steps.push({
      id: `round-${round}/terrain`,
      message: `Round ${round}: developing relief (${label})`,
      run(state) {
        state.round = round;
        if (!physical) return;
        developTerrain(state, round);
        if (round > 1) applySupports(state);
        updateSlopes(state);
      },
    });
    steps.push({
      id: `round-${round}/water`,
      message: `Round ${round}: routing water and access`,
      run: (state) => routeWater(state),
    });
    steps.push({
      id: `round-${round}/environment`,
      message: `Round ${round}: evaluating climate and magic on the shared media`,
      run(state) {
        respondClimate(state);
        if (!magic) return;
        // The one declared follow-up: relief magic changed by a resolvable amount reroutes
        // water before the living landscape and places read it.
        const changed = respondMagic(state);
        if ((changed.get("elevation") ?? 0) >= reliefFollowUp) {
          fillRegionalPits(state);
          routeWater(state);
        }
      },
    });
    if (geography)
      steps.push({
        id: `round-${round}/cover`,
        message: `Round ${round}: developing the living landscape`,
        run: (state) => respondCover(state),
      });
    if (society)
      steps.push({
        id: `round-${round}/places`,
        message:
          round === 2
            ? "Round 2: supporting known places and proposing local ones"
            : `Round ${round}: supporting places`,
        run: (state) => respondPlaces(state, round),
      });
  }
  steps.push({
    id: "refresh",
    message: "Refreshing derived reads after the last changes",
    run(state) {
      state.round = terrainRounds.length + 1;
      if (physical) {
        applySupports(state);
        fillRegionalPits(state);
      }
      updateSlopes(state);
      routeWater(state);
      respondClimate(state);
      if (geography) respondCover(state);
    },
  });
  if (geography) {
    steps.push({
      id: "landforms",
      message: "Naming summits, cols, ranges and valleys",
      run: extractLandforms,
    });
    steps.push({
      id: "water-geometry",
      message: "Drawing shores, lakes and rivers",
      run: extractWaterGeometry,
    });
  }
  if (magic)
    steps.push({
      id: "magic-places",
      message: "Classifying magical geography",
      run: extractMagicPlaces,
    });
  if (geography)
    steps.push({ id: "habitats", message: "Outlining named habitats", run: extractHabitats });
  if (society)
    steps.push({ id: "places", message: "Placing villages and local ways", run: extractPlaces });
  if (physical)
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

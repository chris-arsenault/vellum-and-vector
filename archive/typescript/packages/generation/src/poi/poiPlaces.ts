import type { AtlasFeature } from "@atlas/domain";
import { components } from "../world/geographicRegions";
import { generationFeatures } from "../generationFeatures";
import type { GenerationState } from "../process";
import { positionOf } from "../regional/lattice";
import type { PoiKindId } from "./poiKinds";
import type { PoiPlace } from "./poiContract";
import { featureCell, fieldOf, gap, heldFor, settlementsOf } from "./poiReads";

type IsA = (state: GenerationState, cell: number) => boolean;

/**
 * Places of an emergent kind: each connected group of cells that pass its test, through the
 * generator's own `components`, anchored where `rank` is highest.
 */
export const regionPlaces =
  (kind: PoiKindId, isA: IsA, rank: (state: GenerationState, cell: number) => number = () => 0) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      const places: PoiPlace[] = [];
      components(
        state,
        (i) => isA(state, i),
        (members) => {
          const cells = [...members],
            anchor = cells.reduce((a, b) => (rank(state, b) > rank(state, a) ? b : a), cells[0]);
          places.push({ id: `${kind}:${anchor}`, kind, cells, anchor });
        }
      );
      return places;
    });

/**
 * Places of a kind a magic system grows: each connected group of its rule's members, as the
 * system itself grew them, anchored where the system is strongest. The rule is the definition;
 * the entry adds no second test.
 */
export const rulePlaces =
  (kind: PoiKindId, system: string, rule: string) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `rule:${kind}:${system}:${rule}`, () => {
      const field = state.physical?.magic?.fields.find((f) => f.definition.id === system),
        members = field?.features[rule],
        coverage = field?.coverage[rule];
      if (!field || !members) return [];
      const places: PoiPlace[] = [];
      components(
        state,
        (i) => Boolean(members.get(i)) && (coverage?.get(i) ?? 1) > 0,
        (found) => {
          const cells = [...found],
            anchor = cells.reduce((a, b) =>
              field.intensity.get(b) > field.intensity.get(a) ? b : a
            );
          places.push({ id: `${kind}:${anchor}`, kind, cells, anchor });
        }
      );
      return places;
    });

/** Suitability a cell needs before anyone would site a work of a kind there. */
const worthSiting = 0.5;
/**
 * Places of a kind people site where nothing else has sited them: the best cells that meet its
 * requirement and suit it, best first, each at least `spacing` metres from those already taken.
 */
export const sitedPlaces =
  (
    kind: PoiKindId,
    requires: IsA,
    suitability: (state: GenerationState, cell: number) => number,
    spacing: (state: GenerationState) => number
  ) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `sited:${kind}`, () => {
      // A map with no field, like a floor plan, has no ground to site anything on.
      if (!state.physical) return [];
      const mesh = fieldOf(state).mesh,
        scored: { cell: number; score: number }[] = [];
      for (let cell = 0; cell < mesh.count; cell++) {
        if (mesh.membership(cell) !== 1 || !requires(state, cell)) continue;
        const score = suitability(state, cell);
        if (score >= worthSiting) scored.push({ cell, score });
      }
      scored.sort((a, b) => b.score - a.score || a.cell - b.cell);
      const apart = spacing(state),
        taken: number[] = [];
      for (const { cell } of scored)
        if (taken.every((other) => gap(state, cell, other) >= apart)) taken.push(cell);
      return taken.map((cell) => ({ id: `${kind}:${cell}`, kind, cells: [cell], anchor: cell }));
    });

/** Places of a point kind: each cell that passes its test is one place. */
export const cellPlaces =
  (kind: PoiKindId, isA: IsA) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      const places: PoiPlace[] = [],
        mesh = fieldOf(state).mesh;
      for (let cell = 0; cell < mesh.count; cell++)
        if (mesh.membership(cell) === 1 && isA(state, cell))
          places.push({ id: `${kind}:${cell}`, kind, cells: [cell], anchor: cell });
      return places;
    });

/** Places of a sited kind: the published records it matches. */
export const recordPlaces =
  (kind: PoiKindId, matches: (feature: AtlasFeature) => boolean) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      const places: PoiPlace[] = [];
      if (!state.physical) return places;
      for (const feature of generationFeatures(state))
        if (matches(feature)) {
          const anchor = featureCell(state, feature);
          if (anchor >= 0) places.push({ id: feature.id, kind, cells: [anchor], anchor, feature });
        }
      return places;
    });

/** Whether a cell holds a record of a sited kind. */
export const holdsRecord =
  (kind: PoiKindId, places: (state: GenerationState) => readonly PoiPlace[]) =>
  (state: GenerationState, cell: number) =>
    heldFor(state, `cells:${kind}`, () => new Set(places(state).map((p) => p.anchor))).has(cell);

/** Whether a settlement stands within `reach` metres of a cell. */
export function settlementWithin(state: GenerationState, cell: number, reach: number) {
  for (const town of settlementsOf(state))
    if (gap(state, featureCell(state, town), cell) <= reach) return true;
  return false;
}
/** The naming culture of the settlement nearest a place, or null when none stands on the map. */
export function namingCultureNear(state: GenerationState, place: PoiPlace) {
  let best: string | null = null,
    reach = Infinity;
  for (const town of settlementsOf(state)) {
    const d = gap(state, featureCell(state, town), place.anchor),
      culture = town.attributes.namingCulture;
    if (d < reach && typeof culture === "string") [best, reach] = [culture, d];
  }
  return best;
}

/** Distance in metres from a place's anchor to the nearest of other places, or Infinity. */
export function nearestPlace(state: GenerationState, place: PoiPlace, others: readonly PoiPlace[]) {
  let best = Infinity;
  for (const other of others)
    if (other.id !== place.id) best = Math.min(best, gap(state, place.anchor, other.anchor));
  return best;
}
/** Whether two places lie within `reach` metres of each other, anchor to anchor. */
export const within =
  (reach: (state: GenerationState) => number) =>
  (state: GenerationState, a: PoiPlace, b: PoiPlace) =>
    gap(state, a.anchor, b.anchor) <= reach(state);
/** Whether a place's cells include another place's anchor. */
export const holds = (_state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  a.cells.includes(b.anchor);
/** A place's anchor as map coordinates, for geometry. */
export const anchorAt = (state: GenerationState, place: PoiPlace) =>
  positionOf(fieldOf(state).mesh, place.anchor);

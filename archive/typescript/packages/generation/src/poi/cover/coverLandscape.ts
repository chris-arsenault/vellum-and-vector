import { placeMinimumCells, type AtlasFeature } from "@atlas/domain";
import { biomeRules } from "../../world/ecologyBiomes";
import { biomeFamily, summarize } from "../../world/ecologyFeatures";
import { components, placeFeature } from "../../world/geographicRegions";
import {
  familyMargin,
  landscapeAttributes,
  landscapeExtent,
  landscapeSurface,
} from "../../world/worldEcologyFeatures";
import type { GenerationState } from "../../process";
import type { PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { fieldOf, heldFor, isLand } from "../poiReads";

type Read = (state: GenerationState, cell: number) => number;
type Places = (state: GenerationState) => readonly PoiPlace[];

/** Whether a land cell's biome class belongs to a family: what the biome layer shows there. */
export const isFamily = (family: string) => (state: GenerationState, cell: number) =>
  isLand(state, cell) && biomeFamily(fieldOf(state).BiomeCodes.get(cell)) === family;

/**
 * A family's landscapes: each coherent region of it, and a region broad enough to span a
 * continent divided into provinces along its barriers. Anchored where `rank` is highest.
 */
export const landscapePlaces =
  (kind: PoiKindId, family: string, rank: Read): Places =>
  (state) =>
    heldFor(state, `places:${kind}`, () => {
      const isA = isFamily(family),
        places: PoiPlace[] = [];
      components(
        state,
        (i) => isA(state, i),
        (members) => {
          const cells = [...members],
            anchor = cells.reduce((a, b) => (rank(state, b) > rank(state, a) ? b : a), cells[0]);
          places.push({ id: `${kind}:${anchor}`, kind, cells, anchor });
        },
        false,
        true
      );
      return places;
    });

/** Which of a kind's places each cell belongs to, so neighbouring provinces meet on a line. */
function placeLabels(state: GenerationState, kind: string, places: Places) {
  return heldFor(state, `labels:${kind}`, () => {
    const labels = new Int32Array(fieldOf(state).mesh.count).fill(-1),
      index = new Map<string, number>();
    places(state).forEach((place, n) => {
      index.set(place.id, n);
      for (const cell of place.cells) labels[cell] = n;
    });
    return { labels, index };
  });
}

/**
 * A landscape's record: its outline by the biome class margin, its name from the biome rule,
 * its attributes from its means. It is published under the family's own kind on the ecology
 * layer, as the biome layer groups them.
 */
export const landscapeRecord =
  (kind: string, family: string, places: Places) =>
  (state: GenerationState, place: PoiPlace): AtlasFeature | null => {
    if (place.cells.length < placeMinimumCells.area) return null;
    const rule = heldFor(state, "landscape:rules", () => biomeRules(state)).find(
      (candidate) => candidate.kind === family
    );
    if (!rule) return null;
    const surface = heldFor(state, "landscape:surface", () => landscapeSurface(state)),
      margin = heldFor(state, `landscape:margin:${family}`, () =>
        familyMargin(surface, (code) => biomeFamily(code) === family)
      ),
      { labels, index } = placeLabels(state, kind, places),
      own = index.get(place.id) ?? -1,
      extent = landscapeExtent(
        state,
        surface,
        margin,
        place.cells,
        (i) => Number(labels[i] === own),
        (i) => Number(labels[i] >= 0 && labels[i] !== own)
      );
    if (!extent) return null;
    const summary = summarize(state, place.cells),
      attributes = landscapeAttributes(rule, summary);
    return placeFeature(
      state,
      family,
      attributes.biome,
      place.cells,
      "ecology",
      attributes,
      extent
    );
  };

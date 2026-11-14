import type { AtlasFeature } from "@atlas/domain";
import { nameGeographicFeature, nameMetadata } from "../atlasNaming";
import { hashUnit } from "../world/noise";
import { generationFeature, writeGenerationFeature } from "../generationFeatures";
import type { GenerationState } from "../process";
import type { PoiEntry, PoiNameRelation, PoiNameTerm, PoiPlace } from "./poiContract";

const salt = 0x7031;

/** What a name is without its term: "Skattad" of "Skattad Crag". Null when it has no such end. */
export function stemOf(name: string, term: string | undefined) {
  if (!term || !name.endsWith(` ${term}`)) return null;
  return name.slice(0, -term.length - 1).trim() || null;
}

/** Names a new record in the words its place's character chooses. */
export function applyNameTerm(
  state: GenerationState,
  entry: PoiEntry,
  place: PoiPlace,
  feature: AtlasFeature
) {
  const term = entry.naming.term;
  if (typeof term !== "function") return;
  feature.attributes.nameTerm = term(state, place);
  if (state.retainedFeatureNames?.[feature.id]) return;
  const named = nameGeographicFeature(
    state.domain.world,
    feature.id,
    feature.kind,
    feature.geometry,
    feature.attributes
  );
  if (!named) return;
  feature.name = named.name;
  Object.assign(feature.attributes, nameMetadata(named));
}

interface Named {
  entry: PoiEntry;
  place: PoiPlace;
  featureId: string;
}
const canRename = (state: GenerationState, feature: AtlasFeature) =>
  feature.state === "generated" &&
  !feature.protected &&
  !state.retainedFeatureNames?.[feature.id] &&
  // A captured record keeps the name its parent gave it.
  (!("regional" in state) || feature.attributes.developedBy === "regional");
const relationsOf = (entry: PoiEntry): readonly PoiNameRelation[] => {
  const relations = entry.naming.takesNameFrom;
  return "slot" in relations ? [] : relations.filter((relation) => relation.chance !== undefined);
};
function lenderFor(
  state: GenerationState,
  relation: PoiNameRelation,
  taker: Named,
  all: readonly Named[],
  lent: Set<string>
) {
  for (const lender of all) {
    if (lender.entry.id !== relation.kind || lent.has(lender.featureId)) continue;
    if (!relation.holds(state, taker.place, lender.place)) continue;
    const feature = generationFeature(state, lender.featureId),
      term = feature?.attributes.nameTerm as PoiNameTerm | undefined,
      stem = feature && stemOf(feature.name, term?.term);
    if (stem) return { feature: feature!, stem };
  }
  return null;
}
function takeOne(state: GenerationState, taker: Named, all: readonly Named[], lent: Set<string>) {
  const feature = generationFeature(state, taker.featureId);
  if (!feature || !canRename(state, feature)) return;
  for (const relation of relationsOf(taker.entry)) {
    if (hashUnit(salt, taker.place.anchor, 0) >= relation.chance!) continue;
    const lender = lenderFor(state, relation, taker, all, lent);
    if (!lender) continue;
    lent.add(lender.feature.id);
    feature.name = lender.stem;
    feature.attributes.namedAfter = lender.feature.id;
    feature.causes.push(`Named after ${lender.feature.name}.`);
    writeGenerationFeature(state, feature);
    return;
  }
}
/** The relations with a chance, acted on: a town may take the name of the peak above it. */
export function takeNames(state: GenerationState, all: readonly Named[]) {
  const lent = new Set<string>();
  for (const taker of all) takeOne(state, taker, all, lent);
}

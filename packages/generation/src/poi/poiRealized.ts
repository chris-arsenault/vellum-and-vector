import type { MagicFeatureRule } from "@atlas/domain";
import { craterRelief, volcanicRelief } from "../canonry/geologicalFeatures";
import { keyCols, riverDrop } from "../canonry/landforms";
import type { MagicField } from "../canonry/magicState";
import { significantMagicArea } from "../canonry/worldMagicSignificance";
import { worldFjordLength } from "../canonry/worldSiteEvidence";
import { regionEvidence } from "../canonry/worldRegionEvidence";
import type { GenerationState } from "../process";
import {
  isWorldGeography,
  landscapeSignificance,
  mapScale,
  worldExceptionalLakeArea,
  worldExtent,
  worldFallsDischarge,
  worldFallsDrop,
  worldLakeDepth,
  worldOutletDischarge,
  worldRiverDischarge,
} from "../worldSignificance";
import { magicRuleKinds } from "./magicRuleKinds";
import type { PoiEntry, PoiPlace } from "./poiContract";
import type { PoiKindId } from "./poiKinds";
import { fieldOf, heldFor } from "./poiReads";
import { wrapOf } from "./sea/shoreForm";

/**
 * Whether a place is realized on this map (ADR 0005). One rule for every map, judged at the
 * map's own scale: lengths with its cell span, areas with the square, heights with the root. What
 * fails stays latent in the fields: no place, no record, no effects. A finer map reads the same
 * fields and realizes its own. Drawing is a separate matter, among what is realized.
 */
type Gate = (state: GenerationState, place: PoiPlace) => boolean;

/** World sizes that make a landform a place at the World's scale. */
const worldRise = 600,
  worldCourseLength = 100_000,
  worldCourseRelief = 300,
  worldComplexArea = 8e9,
  worldComplexRelief = 300,
  worldFjordBreadth = 8_000,
  worldLakeArea = 2e9,
  worldVolcanoRelief = 1_000,
  worldCraterRelief = 150,
  worldCraterRadius = 15_000;
/** The share of the circle a coast must wrap for its form to be a named place. */
const clearForm = 0.7;
/** How strong a tie to people carries a landform a size alone would not: a market town beside it. */
const strongTie = 0.45;
/** Sites with magic must mark an exceptional source. */
const exceptionalFireSource = 600,
  exceptionalGeothermal = 400,
  exceptionalIceThickness = 500,
  exceptionalIceCharge = 0.8;
const magicalCourseLength = 100_000,
  magicalCourseCoverage = 0.5;

const evidence = (state: GenerationState, place: PoiPlace) =>
  regionEvidence(fieldOf(state), place.cells);
const areaOf = (state: GenerationState, place: PoiPlace) => evidence(state, place).area;

const course: Gate = (state, place) => {
  const e = evidence(state, place),
    scale = mapScale(state);
  return e.span >= worldCourseLength * scale.length && e.relief >= worldCourseRelief * scale.height;
};
const complex: Gate = (state, place) => {
  const e = evidence(state, place),
    scale = mapScale(state);
  return e.area >= worldComplexArea * scale.area && e.relief >= worldComplexRelief * scale.height;
};
const pass: Gate = (state, place) =>
  (heldFor(state, "relief:keyCols", () => keyCols(fieldOf(state))).get(place.anchor) ?? 0) >=
  worldRise * 1024 * mapScale(state).height;
const waterfall: Gate = (state, place) => {
  const map = fieldOf(state),
    scale = mapScale(state);
  return (
    riverDrop(map, place.anchor) >= worldFallsDrop * scale.height &&
    map.FlowAccumulation.get(place.anchor) >= worldFallsDischarge * scale.area
  );
};
const riverMouth: Gate = (state, place) =>
  fieldOf(state).FlowAccumulation.get(place.anchor) >= worldRiverDischarge * mapScale(state).area;
const fjord: Gate = (state, place) => {
  const e = evidence(state, place),
    scale = mapScale(state);
  return e.span >= worldFjordLength * scale.length && e.breadth >= worldFjordBreadth * scale.length;
};
const lake: Gate = (state, place) => {
  const map = fieldOf(state),
    scale = mapScale(state),
    area = areaOf(state, place);
  if (area >= worldLakeArea * scale.area) return true;
  if (area < worldExceptionalLakeArea * scale.area) return false;
  const reads = (read: (cell: number) => number) =>
    place.cells.reduce((most, cell) => Math.max(most, read(cell)), 0);
  return (
    reads((cell) => map.WaterDepths.get(cell) / 1024) >= worldLakeDepth * scale.height ||
    reads((cell) => map.FlowAccumulation.get(cell)) >= worldOutletDischarge * scale.area
  );
};
const landscape =
  (kind: string): Gate =>
  (state, place) =>
    landscapeSignificance(worldExtent(state), kind, evidence(state, place), mapScale(state))
      .publish;
const eventOf = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).events.find((event) => place.id.startsWith(event.id));
const volcano: Gate = (state, place) => {
  const event = eventOf(state, place);
  return !event || volcanicRelief(state, event) >= worldVolcanoRelief * mapScale(state).height;
};
const crater: Gate = (state, place) => {
  const event = eventOf(state, place),
    scale = mapScale(state);
  if (!event) return true;
  const relief = craterRelief(state, event);
  return (
    event.radius >= worldCraterRadius * scale.length &&
    relief >= worldCraterRelief * scale.height &&
    relief >= state.physical!.profile.ImpactVisibleRelief
  );
};
const clearCoast: Gate = (state, place) => wrapOf(state, place.anchor) >= clearForm;
/** A work too small for the World's cells stays a latent demand there; an authored one stands. */
const belowTheWorld: Gate = (state, place) =>
  !isWorldGeography(state) || place.feature?.state === "authored";

const gates: Partial<Record<PoiKindId, Gate>> = {
  pass,
  ridge: course,
  escarpment: course,
  valley: course,
  gorge: course,
  plateau: complex,
  dome: complex,
  cirque: complex,
  moraine: complex,
  volcano,
  caldera: volcano,
  crater,
  waterfall,
  riverMouth,
  fjord,
  lake,
  wetland: landscape("wetland"),
  headland: clearCoast,
  bay: clearCoast,
  strait: clearCoast,
  forest: landscape("forest"),
  grassland: landscape("grassland"),
  barren: landscape("barren"),
  emberGrove: landscape("ember"),
  thawMeadow: landscape("thaw"),
  rimeForest: landscape("rime"),
  glowBarrens: landscape("glow"),
  fogHeath: landscape("fog"),
  deepwood: landscape("deepwood"),
  wendingFen: landscape("wending"),
  wellMeadow: landscape("well"),
  barrowHeath: landscape("barrow"),
  saltPan: landscape("pan"),
  placer: landscape("magic"),
  mine: belowTheWorld,
  shrine: belowTheWorld,
  forge: belowTheWorld,
  archive: belowTheWorld,
  harbour: belowTheWorld,
  irrigation: belowTheWorld,
  dam: belowTheWorld,
  clearance: belowTheWorld,
  mill: belowTheWorld,
  ford: belowTheWorld,
  bridge: belowTheWorld,
};
/** Kinds a size may not be the only way to: people's ties carry a modest form onto the map. */
const carriedByPeople = new Set(["relief", "water", "sea"]);

function exceptionalSource(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  i: number
) {
  const map = fieldOf(state),
    tests: Record<string, () => boolean> = {
      fire: () =>
        field.source.get(i) >= exceptionalFireSource &&
        map.Geothermal.get(i) >= exceptionalGeothermal,
      aurora: () =>
        map.IceThickness.get(i) >= exceptionalIceThickness &&
        map.IceCharge.get(i) >= exceptionalIceCharge,
      pressure: () => rule.id === "locus" && field.source.get(i) > 0,
      greenwood: () =>
        map.FlowAccumulation.get(i) >= worldRiverDischarge * mapScale(state).area &&
        field.source.get(i) > 0,
      veil: () => rule.id === "door" && (field.originSources.door?.get(i) ?? 0) > 0,
    };
  return tests[field.definition.id]?.() ?? false;
}
function magicPlace(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  place: PoiPlace
) {
  const coverage = (i: number) => field.coverage[rule.id]?.get(i) ?? 1;
  if (
    rule.cartography === "site" &&
    place.cells.some((i) => exceptionalSource(state, field, rule, i))
  )
    return true;
  if (rule.cartography === "course") {
    const e = regionEvidence(fieldOf(state), place.cells, coverage);
    return (
      e.span >= magicalCourseLength * mapScale(state).length && e.strength >= magicalCourseCoverage
    );
  }
  return significantMagicArea(state, place.cells, coverage);
}
/** The system and rule that grew a place, when one did. */
function grownBy(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  for (const field of state.physical?.magic?.fields ?? []) {
    const rules = magicRuleKinds[field.definition.id] ?? {};
    for (const rule of field.definition.features)
      if (rules[rule.id] === entry.id && field.features[rule.id]?.get(place.anchor))
        return { field, rule };
  }
  return null;
}
function tiedToPeople(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  const cultural = entry.visibility.cultural;
  return (
    carriedByPeople.has(entry.group) &&
    typeof cultural === "function" &&
    (cultural as (s: GenerationState, p: PoiPlace) => number)(state, place) >= strongTie
  );
}
/** Whether this place of this kind is realized on this map. */
export function realized(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  // A door is a pair the system itself made; a record is what people or an author made.
  if (entry.id === "door" || !state.physical) return true;
  const grown = grownBy(state, entry, place);
  if (grown && magicPlace(state, grown.field, grown.rule, place)) return true;
  const gate = gates[entry.id];
  if (!grown && (!gate || gate(state, place))) return true;
  return tiedToPeople(state, entry, place);
}

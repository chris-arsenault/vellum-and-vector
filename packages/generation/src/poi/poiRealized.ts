import { MapScale, type MagicFeatureRule } from "@atlas/domain";
import { craterRelief, volcanicRelief } from "../world/geologicalFeatures";
import { keyCols } from "../world/landforms";
import type { MagicField } from "../world/magicState";
import { significantMagicArea } from "../world/worldMagicSignificance";
import { worldFjordLength } from "../world/worldSiteEvidence";
import { regionEvidence } from "../world/worldRegionEvidence";
import type { GenerationState } from "../process";
import {
  isWorldGeography,
  landscapeSignificance,
  mapScale,
  worldExceptionalLakeArea,
  worldExtent,
  worldLakeDepth,
  worldOutletDischarge,
  worldRiverDischarge,
} from "../worldSignificance";
import { magicRuleKinds } from "./magicRuleKinds";
import type { PoiEntry, PoiPlace } from "./poiContract";
import type { PoiKindId } from "./poiKinds";
import { fieldOf, heldFor } from "./poiReads";
import { prominentFall } from "./water/waterfallShape";
import { wrapOf } from "./sea/shoreForm";

/**
 * Whether a place is realized on this map (ADR 0005). One rule for every map, judged at the
 * map's own scale: lengths with its cell span, areas with the square, heights with the root. What
 * fails stays latent in the fields: no place, no record, no effects. A finer map reads the same
 * fields and realizes its own. Drawing is a separate matter, among what is realized.
 */
type Gate = (state: GenerationState, place: PoiPlace) => boolean;

/** World sizes that make a landform a place at the World's scale. */
const worldRise = MapScale.length(0.00015, 0.5),
  worldCourseLength = MapScale.length(0.025),
  worldCourseRelief = MapScale.length(0.000075, 0.5),
  worldComplexArea = MapScale.area(0.0005),
  worldComplexRelief = MapScale.length(0.000075, 0.5),
  worldFjordBreadth = MapScale.length(0.002),
  worldLakeArea = MapScale.area(0.000125),
  worldVolcanoRelief = MapScale.length(0.00025, 0.5),
  worldCraterRelief = MapScale.length(0.0000375, 0.5),
  worldCraterRadius = MapScale.length(0.00375);
/** The share of the circle a coast must wrap for its form to be a named place. */
const clearForm = 0.7;
/** How strong a tie to people carries a landform a size alone would not: a market town beside it. */
const strongTie = 0.45;
/** Sites with magic must mark an exceptional source. */
const exceptionalFireSource = 600,
  exceptionalGeothermal = 400,
  exceptionalIceThickness = MapScale.length(0.000125, 0.5),
  exceptionalIceCharge = 0.8;
const magicalCourseLength = MapScale.length(0.025),
  magicalCourseCoverage = 0.5;

const evidence = (state: GenerationState, place: PoiPlace) =>
  regionEvidence(fieldOf(state), place.cells);
const areaOf = (state: GenerationState, place: PoiPlace) => evidence(state, place).area;

const course: Gate = (state, place) => {
  const e = evidence(state, place),
    scale = mapScale(state);
  return (
    e.span >= scale.resolveMeasure(worldCourseLength) &&
    e.relief >= scale.resolveMeasure(worldCourseRelief)
  );
};
const complex: Gate = (state, place) => {
  const e = evidence(state, place),
    scale = mapScale(state);
  return (
    e.area >= scale.resolveMeasure(worldComplexArea) &&
    e.relief >= scale.resolveMeasure(worldComplexRelief)
  );
};
const pass: Gate = (state, place) =>
  (heldFor(state, "relief:keyCols", () => keyCols(fieldOf(state))).get(place.anchor) ?? 0) >=
  MapScale.native(mapScale(state).resolveMeasure(worldRise));
/** Which water is a river is the river's own test: a fall answers only for its drop. */
const waterfall: Gate = (state, place) => place.origin === "carried" || prominentFall(state, place);
const fjord: Gate = (state, place) => {
  const e = evidence(state, place),
    scale = mapScale(state);
  return (
    e.span >= scale.resolveMeasure(worldFjordLength) &&
    e.breadth >= scale.resolveMeasure(worldFjordBreadth)
  );
};
const lake: Gate = (state, place) => {
  const map = fieldOf(state),
    scale = mapScale(state),
    area = areaOf(state, place);
  if (area >= scale.resolveMeasure(worldLakeArea)) return true;
  if (area < scale.resolveMeasure(worldExceptionalLakeArea)) return false;
  const reads = (read: (cell: number) => number) =>
    place.cells.reduce((most, cell) => Math.max(most, read(cell)), 0);
  return (
    reads((cell) => MapScale.metres(map.WaterDepths.get(cell), "native")) >=
      scale.resolveMeasure(worldLakeDepth) ||
    reads((cell) => map.FlowAccumulation.get(cell)) >= scale.resolveMeasure(worldOutletDischarge)
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
  return (
    !event || volcanicRelief(state, event) >= mapScale(state).resolveMeasure(worldVolcanoRelief)
  );
};
const crater: Gate = (state, place) => {
  const event = eventOf(state, place),
    scale = mapScale(state);
  if (!event) return true;
  const relief = craterRelief(state, event);
  return (
    event.radius >= scale.resolveMeasure(worldCraterRadius) &&
    relief >= scale.resolveMeasure(worldCraterRelief) &&
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
        map.IceThickness.get(i) >= mapScale(state).resolveMeasure(exceptionalIceThickness) &&
        map.IceCharge.get(i) >= exceptionalIceCharge,
      pressure: () => rule.id === "locus" && field.source.get(i) > 0,
      greenwood: () =>
        map.FlowAccumulation.get(i) >= mapScale(state).resolveMeasure(worldRiverDischarge) &&
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
      e.span >= mapScale(state).resolveMeasure(magicalCourseLength) &&
      e.strength >= magicalCourseCoverage
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

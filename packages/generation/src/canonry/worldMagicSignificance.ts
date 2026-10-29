import type { MagicFeatureRule } from "@atlas/domain";
import type { GenerationState } from "../process";
import { landscapeSignificance, worldExtent, worldRiverDischarge } from "../worldSignificance";
import type { MagicField } from "./magicState";
import type { RegionMembers } from "./regionMembers";
import { regionEvidence } from "./worldRegionEvidence";

/** Sustained causal coverage, not a few classified samples, establishes a magical landscape. */
export function significantMagicArea(
  state: GenerationState,
  members: RegionMembers,
  coverage: (i: number) => number
) {
  return landscapeSignificance(
    worldExtent(state),
    "magic",
    regionEvidence(state.physical!.map, members, coverage)
  ).publish;
}
/** Thermal sites must mark an exceptional source in genuinely hot ground. */
const exceptionalFireSource = 600;
const exceptionalGeothermal = 400;
/** A light well needs a large charged reservoir, not just cold surface color. */
const exceptionalIceThickness = 500;
const exceptionalIceCharge = 0.8;
/** A retained material course has a regional transport role beyond a short classified link. */
const magicalCourseLength = 100_000;
const magicalCourseCoverage = 0.5;

function exceptionalSource(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  i: number
) {
  const map = state.physical!.map;
  const tests: Record<string, () => boolean> = {
    fire: () =>
      field.source.get(i) >= exceptionalFireSource &&
      map.Geothermal.get(i) >= exceptionalGeothermal,
    aurora: () =>
      map.IceThickness.get(i) >= exceptionalIceThickness &&
      map.IceCharge.get(i) >= exceptionalIceCharge,
    pressure: () => rule.id === "locus" && field.source.get(i) > 0,
    greenwood: () => map.FlowAccumulation.get(i) >= worldRiverDischarge && field.source.get(i) > 0,
    veil: () => rule.id === "door" && (field.originSources.door?.get(i) ?? 0) > 0,
  };
  return tests[field.definition.id]?.() ?? false;
}
export function significantMagicPlace(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  members: RegionMembers
) {
  const coverage = (i: number) => field.coverage[rule.id]?.get(i) ?? 1;
  if (rule.cartography === "site")
    for (const i of members) if (exceptionalSource(state, field, rule, i)) return true;
  if (rule.cartography === "course") {
    const evidence = regionEvidence(state.physical!.map, members, coverage);
    return evidence.span >= magicalCourseLength && evidence.strength >= magicalCourseCoverage;
  }
  return significantMagicArea(state, members, coverage);
}

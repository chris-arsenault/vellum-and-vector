import { z } from "zod";
import type { AtlasFeature } from "./model";
import { population, type PopulationGroup } from "./society";
import { sameValue } from "./values";
import { requireThat } from "./errors";
import { isSocietyWork } from "./societyFeatures";
import { populationGroupsSchema } from "./populationGroupsSchema";
export { populationGroupsSchema } from "./populationGroupsSchema";
export const societyWorkAttributesSchema = z.object({
  workKind: z.enum([
    "dam",
    "irrigation",
    "pass",
    "harbor",
    "clearance",
    "hunting",
    "conservation",
    "fire-forge",
    "aurora-archive",
    "pressure-diving",
    "tapping",
    "burning",
    "quarrying",
    "weir",
    "ford",
    "bridge",
    "mill",
  ]),
  radius: z.number().finite().positive(),
  magnitude: z.number().finite().nonnegative(),
});

/** The residents a settlement's record describes: its groups, and those living in the town itself. */
interface Residents {
  groups: PopulationGroup[];
  /** Absent where the record does not tell the town from the country around it. */
  town?: number;
}
/** A work a creator draws or edits must say what it is, how far it reaches and how strong it is. */
export function checkAuthoredWork(feature: AtlasFeature) {
  if (isSocietyWork(feature)) societyWorkAttributesSchema.parse(feature.attributes);
}
/**
 * A creator who changes a settlement's groups or its population changes the other with it:
 * the record's resident totals are kept in step on the record itself.
 */
export function editMappedResidents(
  feature: AtlasFeature,
  before: Pick<AtlasFeature, "attributes">
) {
  const old = before.attributes;
  if (
    feature.kind !== "settlement" ||
    !Array.isArray(old.groups) ||
    (sameValue(old.groups, feature.attributes.groups) &&
      old.population === feature.attributes.population)
  )
    return;
  const residents: Residents = {
    groups: populationGroupsSchema.parse(old.groups),
    ...(old.communityPopulation !== undefined ? { town: Number(old.population ?? 0) } : {}),
  };
  editResidentCounts(residents, feature, old);
  const total = population(residents),
    town = residents.town ?? total;
  feature.attributes = {
    ...feature.attributes,
    groups: residents.groups,
    population: town,
    settlementPopulation: town,
    communityPopulation: total,
    ruralPopulation: total - town,
  };
}
function editResidentCounts(
  residents: Residents,
  feature: AtlasFeature,
  attributes: Record<string, unknown>
) {
  const before = population(residents);
  if (!sameValue(attributes.groups, feature.attributes.groups)) {
    residents.groups = populationGroupsSchema.parse(feature.attributes.groups);
    if (residents.town !== undefined)
      residents.town = before > 0 ? (residents.town * population(residents)) / before : 0;
  } else if (feature.attributes.population !== undefined) {
    const count = Number(feature.attributes.population);
    requireThat(
      Number.isFinite(count) && count >= 0,
      "population",
      "Population must be finite and nonnegative."
    );
    resizePopulation(
      residents,
      residents.town !== undefined ? before - residents.town + count : count
    );
    if (residents.town !== undefined) residents.town = count;
  }
}
function resizePopulation(residents: Residents, count: number) {
  const before = population(residents);
  requireThat(
    Number.isFinite(count) && count >= 0,
    "population",
    "Population must be finite and nonnegative."
  );
  requireThat(
    count === 0 || residents.groups.length > 0,
    "population_groups",
    "Add a population group before assigning residents to an empty community."
  );
  residents.groups = residents.groups.map((group) => ({
    ...group,
    count: before > 0 ? (group.count * count) / before : 0,
  }));
  if (before === 0 && count > 0) residents.groups[0].count = count;
}

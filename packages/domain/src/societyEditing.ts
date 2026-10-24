import { z } from "zod";
import type { AtlasFeature } from "./model";
import type { ChangeSet, DomainSnapshot } from "./operations";
import { population, type SocietyCommunity } from "./society";
import { sameValue } from "./values";
import { requireThat } from "./errors";
import { spatial } from "./spatial";
import { isSocietyWork } from "./societyFeatures";

export const populationGroupsSchema = z.array(
  z
    .object({
      people: z.string().min(1),
      culture: z.string().nullable(),
      languages: z.array(z.string()),
      namingLanguage: z.string().nullable().optional(),
      languageShares: z
        .record(
          z.string().min(1),
          z.object({
            knowledge: z.number().finite().min(0).max(1),
            use: z.number().finite().min(0).max(1),
          })
        )
        .optional(),
      religions: z.array(z.string()),
      practices: z.array(z.string()),
      count: z.number().finite().nonnegative(),
    })
    .refine((group) => !group.namingLanguage || group.languages.includes(group.namingLanguage), {
      message: "The naming language must be one of the group's known languages.",
      path: ["namingLanguage"],
    })
    .refine(
      (group) =>
        !group.languageShares ||
        (Object.entries(group.languageShares).every(
          ([id, share]) => group.languages.includes(id) && share.use <= share.knowledge + 1e-12
        ) &&
          group.languages.every((id) => Object.hasOwn(group.languageShares!, id)) &&
          Object.values(group.languageShares).reduce((sum, share) => sum + share.use, 0) <=
            1 + 1e-12),
      {
        message:
          "Language shares must cover the listed languages; naming use cannot exceed knowledge or total 100%.",
        path: ["languageShares"],
      }
    )
);
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
  ]),
  radius: z.number().finite().positive(),
  magnitude: z.number().finite().nonnegative(),
});

/** Present authoring changes the retained residents, never the completed era records. */
export function editSocietyFeature(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  feature: AtlasFeature,
  areaId = feature.areaId
) {
  if (isSocietyWork(feature)) societyWorkAttributesSchema.parse(feature.attributes);
  const prior = snapshot.world.societies?.[areaId];
  if (!prior) return;
  const region = structuredClone(prior);
  const c = region.communities.find((c) => c.id === feature.attributes.communityId);
  if (feature.kind === "settlement" && c) {
    editCommunity(snapshot, feature, c, areaId);
  } else if (isSocietyWork(feature)) editWork(region.works, feature);
  else if (region.politics && ["sovereignty", "control", "claim"].includes(feature.kind))
    editPoliticalFeature(region, feature);
  else return;
  changes.worldMetadata = {
    name: snapshot.world.name,
    seed: snapshot.world.seed,
    epochs: snapshot.world.epochs,
    ...changes.worldMetadata,
    societies: { ...snapshot.world.societies, [region.areaId]: region },
  };
}
function editPoliticalFeature(
  region: NonNullable<DomainSnapshot["world"]["societies"]>[string],
  feature: AtlasFeature
) {
  const polity = feature.relations.find((r) =>
    ["sovereign", "controlledBy", "claimedBy"].includes(r.kind)
  )?.targetId;
  if (!polity) return;
  const members = region.communities
    .filter((c) => spatial.pointCoverage(feature.geometry)(c.position))
    .map((c) => c.id);
  const politics = region.politics!;
  if (feature.kind === "claim") {
    const p = politics.polities.find((p) => p.id === polity);
    if (p) p.claims = members;
    return;
  }
  const field = feature.kind === "control" ? politics.control : politics.sovereignty;
  for (const [id, owner] of Object.entries(field)) if (owner === polity) delete field[id];
  for (const id of members) field[id] = polity;
}
function editWork(
  works: NonNullable<DomainSnapshot["world"]["societies"]>[string]["works"],
  feature: AtlasFeature
) {
  const work = works.find((w) => w.id === feature.attributes.workId);
  if (!work) return;
  work.previousShape ??= {
    position: { ...work.position },
    radius: work.radius,
    applied: work.applied,
  };
  work.applied = 0;
  const magnitude = Number(feature.attributes.magnitude),
    radius = Number(feature.attributes.radius);
  requireThat(
    Number.isFinite(magnitude) && magnitude >= 0 && Number.isFinite(radius) && radius > 0,
    "society_work",
    "Works need a positive radius and nonnegative magnitude."
  );
  work.magnitude = magnitude;
  work.radius = radius;
  work.maintained = feature.attributes.maintained !== false;
  work.authored = true;
  if (work.name !== feature.name) {
    work.name = feature.name;
    delete work.naming;
    feature.attributes.namingLanguage = null;
    feature.attributes.namingCulture = null;
    feature.attributes.namedInEra = "Creator edit";
  }
  if (feature.geometry.type === "Point")
    work.position = {
      x: feature.geometry.coordinates[0],
      y: feature.geometry.coordinates[1],
      z: 0,
    };
}

function editCommunity(
  snapshot: DomainSnapshot,
  feature: AtlasFeature,
  c: SocietyCommunity,
  areaId: string
) {
  const old = snapshot.world.features[feature.id];
  const attributes = old?.detail[areaId]?.attributes ?? old?.attributes;
  editResidentCounts(c, feature, attributes);
  if (c.name !== feature.name) {
    delete c.naming;
    feature.attributes = {
      ...feature.attributes,
      namingLanguage: null,
      namingCulture: null,
      namedInEra: "Creator edit",
    };
  }
  c.name = feature.name;
  c.protected = feature.protected;
  if (feature.geometry.type === "Point")
    c.position = { x: feature.geometry.coordinates[0], y: feature.geometry.coordinates[1], z: 0 };
  const urban = c.settlement?.population ?? population(c);
  feature.attributes = {
    ...feature.attributes,
    population: urban,
    settlementPopulation: urban,
    communityPopulation: population(c),
    ruralPopulation: population(c) - urban,
    groups: c.groups,
  };
  updateCommunityStatus(c);
  c.causes.push(
    "Present population or settlement edited by the creator; completed history retained."
  );
}
function editResidentCounts(
  c: SocietyCommunity,
  feature: AtlasFeature,
  attributes?: Record<string, unknown>
) {
  const before = population(c);
  if (!sameValue(attributes?.groups, feature.attributes.groups)) {
    c.groups = populationGroupsSchema.parse(feature.attributes.groups);
    if (c.settlement)
      c.settlement.population = before > 0 ? (c.settlement.population * population(c)) / before : 0;
  } else if (feature.attributes.population !== undefined) {
    const count = Number(feature.attributes.population);
    requireThat(
      Number.isFinite(count) && count >= 0,
      "population",
      "Population must be finite and nonnegative."
    );
    resizePopulation(c, c.settlement ? before - c.settlement.population + count : count);
    if (c.settlement) c.settlement.population = count;
  }
}
function resizePopulation(c: SocietyCommunity, count: number) {
  const before = population(c);
  requireThat(
    Number.isFinite(count) && count >= 0,
    "population",
    "Population must be finite and nonnegative."
  );
  requireThat(
    count === 0 || c.groups.length > 0,
    "population_groups",
    "Add a population group before assigning residents to an empty community."
  );
  c.groups = c.groups.map((g) => ({ ...g, count: before > 0 ? (g.count * count) / before : 0 }));
  if (before === 0 && count > 0) c.groups[0].count = count;
}
function updateCommunityStatus(c: SocietyCommunity) {
  const residents = c.settlement?.population ?? population(c);
  if (c.settlement) c.settlement.peak = Math.max(c.settlement.peak, residents);
  if (residents === 0) c.status = "abandoned";
  else if (c.status === "abandoned") c.status = "inhabited";
}

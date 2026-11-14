import { languageUse } from "./populationLanguages";
import type { PopulationGroup } from "@atlas/map";
import type { RenderFeature } from "./renderFeature";
import { shareSegments, type Segment, type Series } from "./surfaceData";

export type EntityNames = Readonly<Record<string, { name: string }>>;
export type SettlementFeature = RenderFeature & { causes: string[] };

/**
 * What a settlement's own record says of it, shaped for the inspector. A generated place
 * states its people, its country and who lives there; a drawn one may describe its residents
 * as groups instead. Nothing here reads beyond the record and the features beside it.
 */
const count = (feature: RenderFeature, key: string) => {
  const value = Number(feature.attributes[key]);
  return Number.isFinite(value) ? value : 0;
};
const text = (feature: RenderFeature, key: string) =>
  typeof feature.attributes[key] === "string" ? (feature.attributes[key] as string) : null;

export interface PlaceFacts {
  /** People living in the place itself, on the land around it, and both together. */
  townsfolk: number;
  country: number;
  people: number;
  /** The most townsfolk it ever held. */
  peak: number;
  founded: string | null;
  abandoned: string | null;
  status: "inhabited" | "abandoned" | "ruined";
  /** The country that reaches it most cheaply and feeds it, in square kilometres. */
  countryKm2: number;
}
export function placeFacts(feature: RenderFeature): PlaceFacts {
  const townsfolk = count(feature, "settlementPopulation") || count(feature, "population"),
    people = Math.max(townsfolk, count(feature, "communityPopulation")),
    status = text(feature, "status");
  return {
    townsfolk,
    people,
    country: people - townsfolk,
    peak: Math.max(townsfolk, count(feature, "peakPopulation")),
    founded: text(feature, "founded"),
    abandoned: text(feature, "abandoned"),
    status: status === "abandoned" || status === "ruined" ? status : "inhabited",
    countryKm2: count(feature, "hinterlandKm2"),
  };
}
/** A place's townsfolk and everyone on its ground at the end of each era it stood through. */
export interface PlaceEra {
  era: string;
  townsfolk: number;
  people: number;
}
export function placeEras(feature: RenderFeature): PlaceEra[] {
  const history = feature.attributes.history;
  return Array.isArray(history)
    ? history.flatMap((step: Partial<PlaceEra>) =>
        typeof step?.era === "string"
          ? [
              {
                era: step.era,
                townsfolk: Number(step.townsfolk) || 0,
                people: Number(step.people) || 0,
              },
            ]
          : []
      )
    : [];
}
/** The place's people over its eras; x is the era's position in its history. */
export function eraSeries(eras: PlaceEra[]): Series[] {
  const series = (id: string, label: string, pick: (step: PlaceEra) => number) => ({
    id,
    label,
    points: eras.map((step, index) => ({ x: index, y: pick(step) })),
  });
  return [
    series("people", "Everyone on its ground", (step) => step.people),
    series("settlement", "Settlement residents", (step) => step.townsfolk),
  ];
}
/** How the place's country is used: under crops, under herds, and left as it was. */
export function countryUseSegments(feature: RenderFeature): Segment[] {
  const farmed = count(feature, "hinterlandFarmedKm2"),
    grazed = count(feature, "hinterlandGrazedKm2"),
    wild = Math.max(0, count(feature, "hinterlandKm2") - farmed - grazed);
  return shareSegments({ farmed, grazed, wild }, practiceLabel);
}
export type PeoplesField = "tongue" | "faith" | "custom" | "allegiance";
/** The share of a generated place's people who hold each tradition of one kind. */
export function peoplesSegments(names: EntityNames, feature: RenderFeature, field: PeoplesField) {
  const peoples = feature.attributes.peoples as
      Partial<Record<PeoplesField, Record<string, number>>> | undefined,
    shares = peoples?.[field];
  return shares && typeof shares === "object"
    ? shareSegments(shares, (id) => entityName(names, id))
    : [];
}
/** The groups a creator described the place's residents as, where the record holds any. */
export function describedGroups(feature: RenderFeature): PopulationGroup[] | null {
  return Array.isArray(feature.attributes.groups)
    ? (feature.attributes.groups as PopulationGroup[])
    : null;
}
export function entityName(names: EntityNames, id: string | null | undefined) {
  return id ? (names[id]?.name ?? id) : "Unspecified";
}
/** Fetch only the named traditions and polity this settlement's presentation uses. */
export function settlementEntityIds(feature: RenderFeature): string[] {
  const ids = new Set<string>();
  const polity = feature.attributes.polityId;
  if (typeof polity === "string") ids.add(polity);
  for (const group of describedGroups(feature) ?? []) {
    for (const id of [
      group.people,
      group.culture,
      ...group.religions,
      ...group.languages,
      ...Object.keys(group.languageShares ?? {}),
    ])
      if (id) ids.add(id);
  }
  for (const id of landEntityIds(feature.attributes.peoples)) ids.add(id);
  return [...ids];
}
function landEntityIds(peoples: unknown) {
  const ids: string[] = [];
  if (peoples && typeof peoples === "object") {
    for (const shares of Object.values(peoples))
      if (shares && typeof shares === "object") ids.push(...Object.keys(shares));
  }
  return ids;
}
/** A practice or channel id as a word: "fire-forge" reads "Fire forge". */
export function practiceLabel(id: string) {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export const roleLabels: Record<string, string> = {
  capital: "Capital",
  regionalCapital: "Regional centre",
  marketTown: "Market town",
};
export function namingUseSegments(names: EntityNames, groups: PopulationGroup[]): Segment[] {
  return shareSegments(languageUse(groups), (id) => entityName(names, id));
}

/** A way that ends at the place, and the place at its other end where the map holds it. */
export interface PlaceWay {
  way: SettlementFeature;
  other: SettlementFeature | undefined;
  travellers: number;
}
export function placeWays(feature: RenderFeature, related: SettlementFeature[]): PlaceWay[] {
  const places = new Map(related.map((item) => [item.id, item]));
  return related
    .filter(
      (item) => item.attributes.fromPlace === feature.id || item.attributes.toPlace === feature.id
    )
    .map((way) => {
      const { fromPlace, toPlace } = way.attributes,
        far = fromPlace === feature.id ? toPlace : fromPlace;
      return {
        way,
        other: typeof far === "string" ? places.get(far) : undefined,
        travellers: count(way, "travellers"),
      };
    })
    .sort((a, b) => b.travellers - a.travellers);
}
/** Travellers on the place's ways by the kind of way: road, track or sea lane. */
export function waySegments(ways: PlaceWay[]): Segment[] {
  const byKind: Record<string, number> = {};
  for (const { way, travellers } of ways) {
    const kind = text(way, "roadClass") ?? way.kind;
    byKind[kind] = (byKind[kind] ?? 0) + travellers;
  }
  return shareSegments(byKind, practiceLabel);
}
/** What was recorded at the place: the events that befell it, or the works raised there. */
export function recordedAt(feature: RenderFeature, related: SettlementFeature[], events: boolean) {
  return related.filter(
    (item) => item.attributes.atPlace === feature.id && (item.kind === "societyEvent") === events
  );
}
/** The territories of the realm the place holds with, among the features beside it. */
export function realmTerritories(feature: RenderFeature, related: SettlementFeature[]) {
  const realm = text(feature, "polityId");
  return realm
    ? related.filter(
        (item) =>
          ["sovereignty", "control", "claim"].includes(item.kind) &&
          item.relations.some((relation) => relation.targetId === realm)
      )
    : [];
}

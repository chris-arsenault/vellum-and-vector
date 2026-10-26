import {
  languageUse,
  population,
  type AtlasFeature,
  type PopulationGroup,
  type SocietyCommunity,
  type SocietyRegion,
  type World,
} from "@atlas/domain";
import { shareSegments, type Segment, type Series } from "./surfaceData";

/** What the settlement surface reads: the community behind a settlement feature. */
export function settlementCommunity(world: World, feature: AtlasFeature, areaId: string) {
  const region = world.societies?.[areaId] ?? world.societies?.[feature.areaId];
  const community = region?.communities.find((c) => c.id === feature.attributes.communityId);
  return region && community ? { region, community } : null;
}
export function entityName(world: World, id: string | null | undefined) {
  return id ? (world.entities[id]?.name ?? id) : "Unspecified";
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

/** The support channels as segments; their sum is the community's capacity. */
export function supportSegments(c: SocietyCommunity): Segment[] {
  return shareSegments(
    {
      farming: c.support.farming,
      grazing: c.support.grazing,
      gathering: c.support.gathering,
      fishing: c.support.fishing,
    },
    practiceLabel
  );
}
export function namingUseSegments(world: World, groups: PopulationGroup[]): Segment[] {
  return shareSegments(languageUse(groups), (id) => entityName(world, id));
}

/** Residents, support and settlement over the recorded steps; x is the step index. */
export function occupationSeries(c: SocietyCommunity): Series[] {
  const steps = c.history ?? [];
  const series = (id: string, label: string, pick: (s: (typeof steps)[number]) => number) => ({
    id,
    label,
    points: steps.map((s, i) => ({ x: i, y: pick(s) })),
  });
  return [
    series("people", "Residents", (s) => s.population),
    series("capacity", "Support", (s) => s.capacity),
    series("settlement", "Settlement", (s) => s.settlementPopulation),
  ];
}
export function stepLabel(c: SocietyCommunity, index: number) {
  const step = c.history?.[Math.round(index)];
  return step ? `${step.era} ${Math.round(step.year)}` : "";
}

/** The works a community made or demands, located ones first. */
export function communityWorks(region: SocietyRegion, communityId: string) {
  return region.works
    .filter((w) => w.communityId === communityId || w.country?.includes(communityId))
    .sort(
      (a, b) =>
        Number(Boolean(a.demand)) - Number(Boolean(b.demand)) || a.kind.localeCompare(b.kind)
    );
}
/** Each connection of a community, with the neighbour it reaches, nearest first. */
export function communityNeighbours(region: SocietyRegion, communityId: string) {
  const byId = new Map(region.communities.map((c) => [c.id, c]));
  return region.connections
    .filter((link) => link.from === communityId || link.to === communityId)
    .map((link) => ({
      link,
      neighbour: byId.get(link.from === communityId ? link.to : link.from),
    }))
    .filter((x): x is { link: (typeof region.connections)[number]; neighbour: SocietyCommunity } =>
      Boolean(x.neighbour)
    )
    .sort((a, b) => a.link.travelCost - b.link.travelCost);
}
export function connectionSegments(neighbours: ReturnType<typeof communityNeighbours>): Segment[] {
  const counts: Record<string, number> = {};
  for (const { link } of neighbours) counts[link.kind] = (counts[link.kind] ?? 0) + 1;
  return shareSegments(counts, practiceLabel);
}
export function communityEvents(region: SocietyRegion, communityId: string) {
  return region.events.filter((e) => e.communities.includes(communityId));
}
/** The polity character as published on its entity, when the eras have run. */
export interface PublishedCharacter {
  practices: Record<string, number>;
  languages: number;
  communities: number;
  people: number;
}
export function publishedCharacter(world: World, polityId: string): PublishedCharacter | null {
  const character = world.entities[polityId]?.attributes.character as
    PublishedCharacter | undefined;
  return character && typeof character === "object" ? character : null;
}
export { population };

import {
  builtinLayers,
  canonicalGeometry,
  unwrapCoordinates,
  population,
  type AtlasFeature,
  type SocietyCommunity,
  type SocietyRegion,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import type { PublicationDefinition } from "./publication";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import {
  generatedFeature,
  putGenerated,
  putGeneratedNetwork,
  putGeneratedDetail,
} from "./mapFeatures";
import { findRoute } from "./mapRouting";
import { communityRoutes } from "./societyContact";
import { profileOf } from "./societyProfile";
import { wayClass, wayClasses } from "./societyWays";
import { publishSocietyWorks } from "./societyWorkPublication";
import { settlementHierarchy, type SettlementHierarchy } from "./societyHierarchy";
import { isMajorSettlement, isWorldSociety } from "./societyMapScope";
import { demandedKinds } from "./societyDemand";
import { publishRuinFields } from "./societyRuins";

export function societyPublications(input: AtlasGenerationInput): PublicationDefinition[] {
  const enabled = ["human.cultures", "human.politics", "built.layout"].some(
    (id) => input.resolvedFeatures?.selection[id]?.enabled
  );
  const base = builtinLayers().find((l) => l.id === "cultures")!;
  const layer = {
    ...base,
    id: "population",
    name: "Population and livelihoods",
    facts: ["populationDensity", "populationCapacity"],
  };
  return ["populationDensity", "populationCapacity"].map((channel) => ({
    kind: "field",
    channel,
    unit: "people/square-kilometre",
    quantity: "intensive",
    layer,
    publish: enabled,
  }));
}
export function publishSettlements(state: GenerationState, context: MapProcessContext) {
  const region = state.society!.region;
  const hierarchy = settlementHierarchy(region);
  const profile = profileOf(state);
  const mapped = new Set(
    region.communities
      .filter(
        (c) =>
          !isWorldSociety(state) ||
          isMajorSettlement(c, hierarchy.get(c.id)!, profile.townThreshold)
      )
      .map((c) => c.id)
  );
  publishSocietyWorks(state);
  publishRuinFields(state);
  for (const c of region.communities) {
    const people = population(c),
      urban = Math.min(people, c.settlement?.population ?? 0);
    if (!c.founded || !mapped.has(c.id)) continue;
    const feature = generatedFeature(
      state,
      `community:${c.id}`,
      c.name,
      "settlement",
      c.status === "inhabited" ? "settlements" : "ruins",
      { type: "Point", coordinates: [c.position.x, c.position.y] },
      {
        communityId: c.id,
        population: urban,
        communityPopulation: people,
        settlementPopulation: urban,
        ruralPopulation: people - urban,
        groups: c.groups,
        livelihoods: c.support,
        status: c.status,
        founded: c.founded,
        representedAreaKm2: c.areaKm2,
        ...siteAttributes(c),
        worksDemanded: demandedKinds(state, c.id),
        ...hierarchy.get(c.id),
        ...communityNameMetadata(c),
      }
    );
    feature.causes = [...c.causes, ...region.history.map((e) => `${e.id}: ${e.causes.join(" ")}`)];
    putCommunity(state, feature, c.id);
  }
  publishRoutes(state, context, mapped, hierarchy);
}
type RoadClass = NonNullable<ReturnType<typeof wayClass>>;
/**
 * Which ways the map shows. At World a land or river way publishes when its use has worn it
 * to a track or a road, whatever the rank of the places at its ends, so roads run through
 * minor country between the towns that made them. A floor keeps every major settlement
 * reachable: its least-cost way to the nearest other major, and a capital's ways to its
 * polity's regional capitals, publish as tracks even where traffic has not worn them yet.
 * Links below the track threshold stay latent for a finer profile. A regional map shows
 * every way between inhabited places, as before. A sea way publishes by the same classes as
 * a shipping lane between the harbours at its ends.
 */
function realizedWays(
  state: GenerationState,
  mapped: Set<string>,
  hierarchy: Map<string, SettlementHierarchy>
) {
  const region = state.society!.region;
  const communities = new Map(region.communities.map((c) => [c.id, c]));
  const realized = new Map<number, RoadClass>();
  const classes = wayClasses(profileOf(state));
  for (const [i, link] of region.connections.entries()) {
    const a = communities.get(link.from)!,
      b = communities.get(link.to)!;
    if (!connectedSettlements(a, b)) continue;
    const cls = isWorldSociety(state)
      ? wayClass(link, classes)
      : (wayClass(link, classes) ?? "track");
    if (cls) realized.set(i, cls);
  }
  for (const i of connectivityFloor(state, mapped, hierarchy))
    if (!realized.has(i)) realized.set(i, "track");
  return realized;
}
/** Links on the least-cost paths that join each major to its nearest major and each capital to its regional capitals. */
function connectivityFloor(
  state: GenerationState,
  mapped: Set<string>,
  hierarchy: Map<string, SettlementHierarchy>
) {
  const region = state.society!.region,
    communities = region.communities;
  const majors = communities.flatMap((c, i) =>
    mapped.has(c.id) && c.founded && c.status === "inhabited" ? [i] : []
  );
  const routes = communityRoutes(region),
    links = new Set<number>();
  const walk = (tree: ReturnType<typeof routes>, from: number, to: number) => {
    for (let cur = from, steps = 0; cur !== to && cur >= 0 && steps < communities.length; steps++) {
      if (tree.via[cur] >= 0) links.add(tree.via[cur]);
      cur = tree.previous[cur];
    }
  };
  for (const i of majors) {
    const tree = routes(i);
    const nearest = majors
      .filter((j) => j !== i && Number.isFinite(tree.distance[j]))
      .reduce<number>((a, j) => (a < 0 || tree.distance[j] < tree.distance[a] ? j : a), -1);
    if (nearest >= 0) walk(tree, nearest, i);
    const role = hierarchy.get(communities[i].id)!;
    if (role.settlementRole !== "capital") continue;
    for (const j of majors) {
      const other = hierarchy.get(communities[j].id)!;
      if (other.settlementRole === "regionalCapital" && other.polityId === role.polityId)
        walk(tree, j, i);
    }
  }
  return [...links];
}
function publishRoutes(
  state: GenerationState,
  context: MapProcessContext,
  mapped: Set<string>,
  hierarchy: Map<string, SettlementHierarchy>
) {
  const region = state.society!.region;
  const communities = new Map(region.communities.map((c) => [c.id, c]));
  const realized = realizedWays(state, mapped, hierarchy);
  let done = 0;
  for (const [i, cls] of realized) {
    const link = region.connections[i],
      a = communities.get(link.from)!,
      b = communities.get(link.to)!;
    context.progress(done++ / Math.max(1, realized.size), "Laying the roads people made");
    // A door is a crossing, not a way over the land between its ends: its doors are the places.
    if (link.kind === "door") continue;
    const kind = link.kind === "sea" ? "lane" : "road";
    // A highway is the straight shot its builders surveyed; every other way follows the land.
    const path = link.highway
      ? [a.position, b.position]
      : findRoute(
          state.surface,
          a.position,
          b.position,
          link.kind === "sea" ? "sea" : "road",
          state.numerical
        );
    if (path.length < 2) continue;
    const feature = generatedFeature(
      state,
      `${kind}:${a.id}:${b.id}`,
      link.highway?.name ?? `${a.name}–${b.name}`,
      kind,
      "roads",
      canonicalGeometry(state.domain.world.reference, {
        type: "LineString",
        coordinates: unwrapCoordinates(
          path.map((p) => [p.x, p.y]),
          state.surface.periodicWidth
        ),
      }),
      wayAttributes(link, cls, [a, b], hierarchy)
    );
    const retained = putGeneratedDetail(
      state,
      feature,
      (f) =>
        f.kind === kind &&
        ((f.attributes.fromCommunity === a.id && f.attributes.toCommunity === b.id) ||
          (f.attributes.fromCommunity === b.id && f.attributes.toCommunity === a.id))
    );
    if (!retained) putGeneratedNetwork(state, feature);
  }
}
function wayAttributes(
  link: SocietyRegion["connections"][number],
  roadClass: RoadClass,
  ends: [SocietyCommunity, SocietyCommunity],
  hierarchy: Map<string, SettlementHierarchy>
) {
  const [a, b] = ends;
  return {
    fromCommunity: a.id,
    toCommunity: b.id,
    travelCost: link.travelCost,
    roadClass,
    wear: Math.round(link.wear ?? 0),
    wayKind: link.kind,
    ...(link.highway ? { builtBy: link.highway.polity, built: link.highway.built } : {}),
    routePopulation: Math.min(a.settlement?.population ?? 0, b.settlement?.population ?? 0),
    strategic: ends.some((c) =>
      ["capital", "regionalCapital", "marketTown"].includes(hierarchy.get(c.id)!.settlementRole)
    ),
  };
}
/** Why the settlement sits where it does; open plain is the absence of a site. */
function siteAttributes(c: SocietyCommunity) {
  return {
    siteKind: c.site?.kind ?? "plain",
    siteReason: c.site?.reason ?? "open country, where its people are",
    fortress: c.site?.fortress ?? false,
  };
}
function communityNameMetadata(c: SocietyCommunity) {
  return {
    namingLanguage: c.naming?.language ?? null,
    namingCulture: c.naming?.culture ?? null,
    namedInEra: c.naming?.era ?? c.founded,
  };
}
function connectedSettlements(
  a: import("@atlas/domain").SocietyCommunity,
  b: import("@atlas/domain").SocietyCommunity
) {
  return a.founded && b.founded && a.status === "inhabited" && b.status === "inhabited";
}
function putCommunity(state: GenerationState, feature: AtlasFeature, communityId: string) {
  if (
    !putGeneratedDetail(
      state,
      feature,
      (f) => f.kind === "settlement" && f.attributes.communityId === communityId
    )
  )
    putGenerated(state, feature);
}

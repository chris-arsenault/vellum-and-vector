import { builtinLayers, population, representationId, type AtlasFeature } from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import type { PublicationDefinition } from "./publication";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import { generatedFeature, putGenerated, putGeneratedNetwork } from "./mapFeatures";
import { findRoute } from "./mapRouting";
import { publishSocietyWorks } from "./societyWorkPublication";

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
  publishSocietyWorks(state);
  for (const c of region.communities) {
    const people = population(c),
      urban = people * 0.12;
    if (people < 1) c.status = "abandoned";
    const feature = generatedFeature(
      state,
      `community:${c.id}`,
      c.name,
      "settlement",
      "settlements",
      { type: "Point", coordinates: [c.position.x, c.position.y] },
      {
        communityId: c.id,
        population: people,
        settlementPopulation: urban,
        ruralPopulation: people - urban,
        groups: c.groups,
        livelihoods: c.support,
        status: c.status,
        founded: c.founded,
        representedAreaKm2: c.areaKm2,
      }
    );
    feature.causes = [...c.causes, ...region.history.map((e) => `${e.id}: ${e.causes.join(" ")}`)];
    putCommunity(state, feature, c.id);
  }
  const communities = new Map(region.communities.map((c) => [c.id, c]));
  for (const [i, link] of region.connections.entries()) {
    const a = communities.get(link.from)!,
      b = communities.get(link.to)!;
    if (population(a) < 100 || population(b) < 100) continue;
    context.progress(
      i / Math.max(1, region.connections.length),
      "Connecting inhabited communities"
    );
    const path = findRoute(state.surface, a.position, b.position, "road");
    if (path.length < 2) continue;
    putGeneratedNetwork(
      state,
      generatedFeature(
        state,
        `road:${a.id}:${b.id}`,
        `${a.name}–${b.name}`,
        "road",
        "roads",
        { type: "LineString", coordinates: path.map((p) => [p.x, p.y]) },
        { fromCommunity: a.id, toCommunity: b.id, travelCost: link.travelCost }
      )
    );
  }
}
function putCommunity(state: GenerationState, feature: AtlasFeature, communityId: string) {
  const world = state.domain.world;
  const previous = Object.values(world.features).find(
    (f) =>
      f.kind === "settlement" &&
      f.attributes.communityId === communityId &&
      f.areaId !== feature.areaId
  );
  if (!previous) {
    putGenerated(state, feature);
    return;
  }
  const detail = previous.detail[feature.areaId];
  if (
    previous.protected ||
    previous.state === "authored" ||
    detail?.protected ||
    detail?.state === "authored"
  )
    return;
  previous.detail[feature.areaId] = {
    id: representationId(world.id, previous.id, feature.areaId),
    geometry: feature.geometry,
    attributes: feature.attributes,
    state: "generated",
    protected: false,
    needsReconciliation: false,
    actor: "generator",
    generationId: null,
  };
}

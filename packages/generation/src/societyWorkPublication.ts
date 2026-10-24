import { generatedFeature, putGenerated } from "./mapFeatures";
import type { GenerationState } from "./process";
import { societyWorkName } from "./societyNaming";
import type { AtlasFeature, SocietyWork } from "@atlas/domain";
import { isSocietyWork, societyWorkLayers } from "@atlas/domain";
import { namingVersion } from "./atlasNaming";
import { isWorldSociety } from "./societyMapScope";

function nameUnrecordedWork(state: GenerationState, work: SocietyWork) {
  if (work.name) return;
  const community = state.society!.region.communities.find((c) => c.id === work.communityId);
  if (!community) return;
  const named = societyWorkName(state.domain.world, community, work);
  work.name = named.name;
  work.naming = { language: named.namingLanguage, culture: named.namingCulture, era: work.built };
}
function workName(state: GenerationState, work: SocietyWork, previous?: AtlasFeature) {
  // A retained map name takes precedence over vocabulary revisions or a changed population.
  if (previous) return { name: previous.name, attributes: previous.attributes };
  nameUnrecordedWork(state, work);
  return {
    name: work.name ?? "Unnamed work",
    attributes: {
      namingKind: "societyWork",
      namingVersion,
      namingSubkind: work.kind,
      namingCulture: work.naming?.culture ?? null,
      namingLanguage: work.naming?.language ?? null,
      namedInEra: work.naming?.era ?? null,
    },
  };
}

export function publishSocietyWorks(state: GenerationState) {
  const region = state.society!.region;
  const existing = new Map(
    Object.values(state.domain.world.features)
      .filter(isSocietyWork)
      .map((f) => [f.attributes.workId, f])
  );
  for (const w of region.works) {
    if (w.authored && state.domain.world.features[w.id]) continue;
    // A demand is a latent quantity, not a feature, at every profile; the World publishes
    // no generated works at all (ADR 0005).
    if (isWorldSociety(state) || w.demand) {
      nameUnrecordedWork(state, w);
      continue;
    }
    const named = workName(state, w, existing.get(w.id));
    const feature = generatedFeature(
      state,
      `work:${w.id}`,
      named.name,
      w.kind,
      societyWorkLayers[w.kind],
      { type: "Point", coordinates: [w.position.x, w.position.y] },
      {
        ...named.attributes,
        workId: w.id,
        workKind: w.kind,
        communityId: w.communityId,
        radius: w.radius,
        magnitude: w.magnitude,
        condition: w.condition,
        maintained: w.maintained,
        built: w.built,
      }
    );
    feature.causes = w.causes;
    putGenerated(state, feature);
  }
  for (const event of region.events) {
    if (isWorldSociety(state) && event.casualties + event.displaced < 10000) continue;
    const feature = generatedFeature(
      state,
      `event:${event.id}`,
      `${event.kind} — ${event.era}`,
      "societyEvent",
      "historicalEvents",
      { type: "Point", coordinates: [event.position.x, event.position.y] },
      {
        eventId: event.id,
        eventKind: event.kind,
        era: event.era,
        radius: event.radius,
        casualties: event.casualties,
        displaced: event.displaced,
        magnitude: event.magnitude,
      }
    );
    feature.causes = event.causes;
    putGenerated(state, feature);
  }
}

import { generatedFeature, putGenerated } from "./mapFeatures";
import type { GenerationState } from "./process";

export function publishSocietyWorks(state: GenerationState) {
  const region = state.society!.region;
  for (const w of region.works) {
    if (w.authored && state.domain.world.features[w.id]) continue;
    const feature = generatedFeature(
      state,
      `work:${w.id}`,
      `${w.kind} at ${region.communities.find((c) => c.id === w.communityId)?.name ?? "settlement"}`,
      "societyWork",
      "settlements",
      { type: "Point", coordinates: [w.position.x, w.position.y] },
      {
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
    const feature = generatedFeature(
      state,
      `event:${event.id}`,
      `${event.kind} — ${event.era}`,
      "societyEvent",
      "settlements",
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

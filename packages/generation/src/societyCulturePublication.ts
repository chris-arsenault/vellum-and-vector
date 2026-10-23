import { population, putChannel } from "@atlas/domain";
import type { GenerationState } from "./process";
import { generatedFeature, putGenerated } from "./mapFeatures";

export function publishCultures(state: GenerationState) {
  const work = state.society!,
    world = state.domain.world;
  for (const entity of Object.values(world.entities)) {
    if (!["culture", "language", "religion"].includes(entity.kind)) continue;
    const fractions = work.region.communities.map((c) => {
      const members = c.groups.reduce((sum, g) => {
        const affiliated =
          entity.kind === "culture"
            ? g.culture === entity.id
            : entity.kind === "language"
              ? g.languages.includes(entity.id)
              : g.religions.includes(entity.id);
        return sum + (affiliated ? g.count : 0);
      }, 0);
      return members / Math.max(1e-12, population(c));
    });
    const values = Float64Array.from(
      state.surface.active,
      (_a, i) => fractions[work.owner[i]] ?? 0
    );
    putChannel(state.surface, `${entity.kind}:${entity.id}`, "ratio", values);
  }
  for (const c of work.region.communities) {
    const group = [...c.groups].sort((a, b) => b.count - a.count)[0];
    if (!group?.culture) continue;
    const marker = generatedFeature(
      state,
      `cultural-community:${c.id}`,
      `${c.name} community`,
      "culturalOrigin",
      "cultures",
      { type: "Point", coordinates: [c.position.x, c.position.y] },
      { communityId: c.id, population: population(c), groups: c.groups }
    );
    marker.relations = [{ targetId: group.culture, kind: "communityOf" }];
    marker.causes = [...c.causes];
    putGenerated(state, marker);
    if (population(c) > 5000) publishInstitution(state, c.id, c.name, c.position, group);
  }
}
function publishInstitution(
  state: GenerationState,
  id: string,
  name: string,
  p: { x: number; y: number },
  group: { languages: string[]; religions: string[] }
) {
  const institution = generatedFeature(
    state,
    `institution:${id}`,
    `${name} meeting house`,
    "institution",
    "cultures",
    { type: "Point", coordinates: [p.x, p.y] },
    { function: "teaching and communal tradition", communityId: id }
  );
  institution.relations = [...group.languages, ...group.religions].map((targetId) => ({
    targetId,
    kind: "transmits",
  }));
  putGenerated(state, institution);
}

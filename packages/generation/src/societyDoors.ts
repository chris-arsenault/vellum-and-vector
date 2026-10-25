import { spatial } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { SocietyEdge } from "./societyGeography";
import { nativePosition } from "./canonry/atlasWorkspace";
import { nearestSocietySample } from "./societySpatial";
import { dryLand } from "./societySupport";

/**
 * Veil's doors: an edge between the dry cells under a door's two ends at the crossing cost,
 * however far apart they lie. Doors join countries when connections are built, not when
 * territories are assigned, so no country reaches through one; a door whose far end lies
 * outside this area leads nowhere here.
 */
export function doorEdges(state: GenerationState): SocietyEdge[] {
  const work = state.physical,
    field = work?.magic?.fields.find(
      (candidate) => candidate.definition.enabled && candidate.definition.effects.tearing > 0
    );
  if (!work || !field) return [];
  const cost = field.definition.parameters.doorTravel,
    covers = spatial.pointCoverage(state.domain.scope.footprint),
    edges: SocietyEdge[] = [];
  for (const door of field.doors) {
    const ends = [door.a, door.b].map((cell) => {
      const p = nativePosition(work, cell);
      return covers(p) ? nearestSocietySample(state.surface, p, (i) => dryLand(state, i)) : -1;
    });
    if (ends[0] < 0 || ends[1] < 0 || ends[0] === ends[1]) continue;
    edges.push({ a: ends[0], b: ends[1], distance: cost, cost, kind: "door" });
  }
  return edges;
}

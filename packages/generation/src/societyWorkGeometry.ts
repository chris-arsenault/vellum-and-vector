import {
  point,
  spatial,
  societyWorkNatures,
  type SocietyWork,
  type SocietyEvent,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { nearestSample } from "./societySpatial";

/** Activity outlines need at least two samples across their modeled diameter. */
const activitySamplesAcross = 2;
export function societyWorkGeometry(state: GenerationState, work: SocietyWork) {
  const site = point(work.position),
    nature = societyWorkNatures[work.kind].nature;
  if (nature !== "intensive")
    return { geometry: site, meaning: "located work site; radius describes modeled reach" };
  const cell = nearestSample(state, work.position);
  if (cell < 0 || work.radius * 2 < Math.sqrt(state.surface.measures[cell]) * activitySamplesAcross)
    return { geometry: site, meaning: "work site; activity extent unresolved at this profile" };
  const disk = spatial.buffer(site, work.radius);
  const extent = disk && spatial.intersection(disk, state.domain.scope.footprint);
  return extent
    ? { geometry: extent, meaning: "modeled activity area; not a surveyed boundary" }
    : { geometry: site, meaning: "located work site" };
}
/** A record's affected communities support their extents, not an invented circular damage zone. */
export function eventFootprint(state: GenerationState, event: SocietyEvent) {
  const communities = state.society!.region.communities;
  const extents = event.communities.flatMap((id) => {
    const community = communities.find((c) => c.id === id);
    return community?.footprint ? [community.footprint] : [];
  });
  return extents.length
    ? spatial.intersection(spatial.unionAll(extents), state.domain.scope.footprint)
    : null;
}

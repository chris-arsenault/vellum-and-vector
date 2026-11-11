import { MapScale, semanticId, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { lakeFootprint, clipGeographicArea } from "./geographicContours";
import { lakeMembership } from "./lakeMembership";

/**
 * Every physical shoreline, which the land and water surfaces read. The lake entry publishes
 * these outlines; a lake's identity is the same key on the surface and on its record.
 */
export function extractLakes(state: GenerationState) {
  const map = state.physical!.map,
    membership = lakeMembership(map);
  state.surface.lakes = [];
  state.physical!.lakeOutlines = new Map();
  for (const body of membership.bodies()) {
    const members = membership.members(body);
    if (!members.some((i) => map.mesh.membership(i) === 1)) continue;
    const level = map.WaterSurfaceElevations.get(members[0]),
      contour = lakeFootprint(state, members, body, level),
      shape = clipGeographicArea(state, contour);
    if (!shape) continue;
    const key = `lake:${spatial
      .bounds(shape)
      .map((value) => value.toFixed(3))
      .join(":")}`;
    state.surface.lakes.push({
      id: semanticId(state.domain.world.id, `generated:${state.domain.scope.areaId}`, key),
      geometry: shape,
      level: MapScale.metres(level, "native"),
    });
    state.physical!.lakeOutlines.set(body, shape);
  }
}

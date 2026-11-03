import { spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { lakeSignificance, mapScale } from "../worldSignificance";
import { lakeFootprint, areaGeometry } from "./geographicContours";
import { lakeMembership } from "./lakeMembership";

/** Every physical shoreline survives; only water bodies significant at the map's scale are named. */
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
      shape = areaGeometry(contour && spatial.intersection(contour, state.domain.scope.footprint));
    if (!shape) continue;
    const area = spatial.area(shape),
      depth = members.reduce((v, i) => Math.max(v, map.WaterDepths.get(i) / 1024), 0),
      throughflow = members.reduce((v, i) => Math.max(v, map.FlowAccumulation.get(i)), 0),
      judgment = lakeSignificance(area, depth, throughflow, mapScale(state)),
      feature = generatedFeature(
        state,
        `lake:${spatial
          .bounds(shape)
          .map((value) => value.toFixed(3))
          .join(":")}`,
        `Lake ${body}`,
        "lake",
        "lakes",
        shape,
        {
          sourceAlgorithm: "canonry-0f62584c",
          waterBody: body,
          waterLevel: (level - map.BaseSeaLevel) / 1024,
          area,
          worldSignificance: judgment.reason,
        }
      );
    state.surface.lakes.push({
      id: feature.id,
      geometry: shape,
      level: Number(feature.attributes.waterLevel),
    });
    state.physical!.lakeOutlines.set(body, shape);
    // The water is physical on every map; its name and outline belong only where significant.
    if (judgment.publish) putGenerated(state, feature);
  }
}

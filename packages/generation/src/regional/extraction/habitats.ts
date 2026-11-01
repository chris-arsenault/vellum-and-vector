import {
  classMarginInterpolator,
  fieldContour,
  gridPosition,
  gridWindowCells,
  regularContourSupport,
  spatial,
  surfaceCode,
} from "@atlas/domain";
import { namedBiomeLandShare } from "../../canonry/ecologyBiomes";
import { fillContourHoles } from "../../canonry/geographicContours";
import { putRegionalFeature } from "./features";
import { regionalComponents, resolvesRegionalComponent, type RegionalState } from "../state";

/** Named habitats from the surface classes, under the land-share, footprint and gap rules. */
export function extractHabitats(state: RegionalState) {
  const g = state.surface;
  const habitats = {
    forest: ["Woodland", "Temperate forest", "Boreal forest", "Rainforest"],
    wetland: ["Marsh", "Swamp", "Wet tundra"],
    grassland: ["Grassland", "Savanna", "Open field", "Cold steppe"],
  } as const;
  const rules = Object.entries(habitats).map(([kind, names]) => ({
      kind: kind as keyof typeof habitats,
      codes: new Set(names.map((name) => surfaceCode(name))),
    })),
    labels = g.coverage.scratch("uint8", "regional:named-habitat", g.active.length);
  let land = 0;
  for (let i = 0; i < g.active.length; i++)
    if (g.active.get(i) && g.channels.water.get(i) === 0) land += g.measures.get(i);
  for (const [index, { kind, codes }] of rules.entries())
    regionalComponents(
      g,
      (i) => codes.has(g.channels.naturalSurface.get(i)),
      (members) => {
        const area = members.reduce((sum, i) => sum + g.measures.get(i), 0);
        if (area >= land * namedBiomeLandShare[kind] && resolvesRegionalComponent(g, members))
          for (const i of members) labels.set(i, index + 1);
      }
    );
  for (const [index, { kind, codes }] of rules.entries()) {
    const at = classMarginInterpolator(g, "naturalSurface", (code) => codes.has(code));
    const shape = fieldContour(
      g,
      (x, y) => at({ x, y, z: 0 }),
      regularContourSupport(g, (i) => labels.get(i) === index + 1),
      0,
      (g.scope.resolution ?? 1000) / 4,
      state.contours
    );
    if (!shape) continue;
    const extent = fillContourHoles(shape, land * namedBiomeLandShare[kind], (hole) => {
      const covers = spatial.pointCoverage(hole);
      for (const i of gridWindowCells(g, spatial.bounds(hole)))
        if (
          (g.channels.water.get(i) !== 0 || (labels.get(i) > 0 && labels.get(i) !== index + 1)) &&
          covers(gridPosition(g, i))
        )
          return true;
      return false;
    });
    putRegionalFeature(state, `habitat:${kind}`, kind, "ecology", extent, { biome: kind });
  }
  g.coverage.release(labels);
}

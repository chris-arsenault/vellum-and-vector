import {
  biomeCode,
  biomes,
  fieldContour,
  regularContourSupport,
  classMarginInterpolator,
  gridPosition,
  gridWindowCells,
  fieldPosition,
  polygonParts,
  translateGeometry,
  spatial,
  surfaceCode,
  naturalSurfaceNames,
  type NaturalSurfaceName,
} from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import {
  channel,
  clamp,
  regionalComponents,
  resolvesRegionalComponent,
  type RefinementState,
} from "./state";
import { gradient } from "./terrain";
import { putRefinementFeature } from "./features";
import { regionalMoisture, regionalWetness } from "./environment";
import { namedBiomeLandShare } from "../canonry/ecologyBiomes";
import { fillContourHoles } from "../canonry/geographicContours";
import { Landform } from "../canonry/codes";

export function refineLocalConditions(state: RefinementState) {
  const g = state.surface,
    temperature = channel(state, "temperature", "celsius", 15),
    moisture = channel(state, "moisture", "ratio", 0.5),
    rain = channel(state, "rainfall", "metre/year", 0.8),
    runoff = channel(state, "runoff", "metre/year", 0.4),
    soil = channel(state, "soilDepth", "metre", 0.6),
    windX = g.channels.windEast,
    windY = g.channels.windNorth;
  if (!state.input.domains.includes("physical")) return;
  for (let i = 0; i < g.active.length; i++) {
    const delta = g.channels.elevation.get(i) - state.inheritedHeight.get(i),
      { gx, gy } = gradient(state, i),
      exposure = gx * (windX?.get(i) ?? 1) + gy * (windY?.get(i) ?? 0),
      rainFactor = 1 + 0.35 * Math.tanh(exposure / 0.01);
    temperature.add(i, -delta * 0.0065);
    rain.set(i, Math.max(0, rain.get(i) * rainFactor));
    moisture.set(i, clamp(moisture.get(i) * rainFactor - delta / 10000));
    soil.set(i, Math.max(0.02, soil.get(i) + (g.channels.sediment?.get(i) ?? 0) * 0.3));
    // Retain the captured runoff regime; exposure changes its local precipitation supply.
    runoff.set(i, Math.max(0, runoff.get(i) * rainFactor));
  }
}
/**
 * The captured cover is this map's prior. A cell departs from it only where a
 * feature resolved at this scale changes its conditions: new relief cold enough for
 * tundra, a river's floodplain, a coastal flat, steep bare ground, or a lake.
 * No ecological years or stock-renewal schedule are executed.
 */
export function refineLivingCover(state: RefinementState) {
  if (!state.input.domains.some((id) => id === "physical" || id === "magic")) return;
  const g = state.surface,
    tree = channel(state, "treeCover", "ratio"),
    grass = channel(state, "grassCover", "ratio"),
    wetland = channel(state, "wetlandCover", "ratio"),
    biome = channel(state, "biome", "category"),
    natural = channel(state, "naturalSurface", "category"),
    final = channel(state, "finalSurface", "category"),
    material = channel(state, "physicalMaterial", "category"),
    naturalTemp = channel(state, "naturalTemperature", "celsius"),
    lakes = realizedLakeCells(state),
    priorBiome = smoothPrior(state, biome),
    priorSurface = smoothPrior(state, natural);
  for (let i = 0; i < g.active.length; i++) {
    const temperature = g.channels.temperature.get(i),
      soil = clamp(0.55 + g.channels.soilDepth.get(i) / 1.2),
      steep = clamp(1 - (g.channels.slope.get(i) - 0.08) / 0.2),
      salting = g.channels.salting?.get(i) ?? 0,
      verdure = g.channels.verdure?.get(i) ?? 0;
    tree.set(i, clamp((tree.get(i) * soil * steep + verdure * 0.3) * (1 - salting)));
    grass.set(i, clamp(grass.get(i) * Math.max(steep, 0.4) * (1 - salting)));
    wetland.set(i, clamp(Math.max(wetland.get(i), (regionalWetness(state, i) - 0.5) * 2)));
    const name = coverName(state, i, lakes.get(i) > 0, priorBiome[i]);
    biome.set(i, biomeCode(name));
    naturalTemp.set(i, temperature);
    const surface = naturalName(state, i, name, priorSurface[i]);
    natural.set(i, surfaceCode(surface));
    // Magic cartography lays its own surfaces over this afterwards.
    final.set(i, natural.get(i));
    material.set(i, materialCode(state, i));
  }
  g.coverage.release(lakes);
}
/** Prior share of a parent sample span that class boundaries are displaced, rounding its cell corners. */
const priorDisplacement = 0.45;
/**
 * The captured class at a displaced position. Parent classes arrive as whole parent
 * samples; displacing the lookup turns their square corners into natural boundaries.
 */
function smoothPrior(state: RefinementState, band: import("@atlas/domain").Band) {
  const g = state.surface,
    [dx, dy] = [
      (g.bounds[2] - g.bounds[0]) / (g.width - 1),
      (g.bounds[3] - g.bounds[1]) / (g.height - 1),
    ],
    reach = state.parentSpan * priorDisplacement,
    prior = new Int32Array(g.active.length);
  for (let i = 0; i < prior.length; i++) {
    const p = gridPosition(g, i),
      ox = fractalNoise(p.x, p.y, state.input.seed ^ 0x2b71, state.parentSpan, 3) * reach,
      oy = fractalNoise(p.x, p.y, state.input.seed ^ 0x6d19, state.parentSpan, 3) * reach,
      x = clamp(Math.round((i % g.width) + ox / dx), 0, g.width - 1),
      y = clamp(Math.round(Math.floor(i / g.width) + oy / dy), 0, g.height - 1);
    prior[i] = band.get(y * g.width + x);
  }
  return prior;
}
/** A submesh pond remains water context without replacing its terrestrial surroundings. */
function realizedLakeCells(state: RefinementState) {
  const g = state.surface,
    mask = g.coverage.scratch("uint8", "regional:realized-lakes", g.active.length);
  for (const lake of g.lakes ?? [])
    for (const part of polygonParts(lake.geometry)) {
      const [x, y] = part.coordinates[0][0],
        offset = fieldPosition(g, { x, y, z: 0 }).x - x,
        geometry = offset ? translateGeometry(part, offset) : part,
        covered = spatial.pointCoverage(geometry);
      for (const i of gridWindowCells(g, spatial.bounds(geometry)))
        if (g.channels.water.get(i) === 2 && covered(gridPosition(g, i))) mask.set(i, 1);
    }
  return mask;
}
type BiomeName = (typeof biomes)[number]["name"];
/** Classes that are always valid to keep, even where new relief cools the ground. */
const coldCover = new Set<BiomeName>([
  "Tundra",
  "Ice",
  "Barren",
  "Rime forest",
  "Glow-lichen barrens",
]);
function coverName(state: RefinementState, i: number, lake: boolean, prior: number): BiomeName {
  const c = state.surface.channels,
    captured = biomes[prior]?.name;
  if (c.water.get(i) === 1) return "Ocean";
  if (lake) return "Freshwater";
  if ((c.ice?.get(i) ?? 0) > 0.3) return "Ice";
  // Land the captured map held as water, or never classified, takes its climate's cover.
  if (!captured || ["Unclassified", "Ocean", "Freshwater"].includes(captured))
    return climateCover(state, i);
  return resolvedCover(state, i, captured);
}
/** Classes this map's own relief and channels can impose on captured cover. */
const resolvedCovers = new Set<BiomeName>(["Tundra", "Marsh", "Swamp"]);
function resolvedCover(state: RefinementState, i: number, captured: BiomeName): BiomeName {
  const c = state.surface.channels;
  if (c.temperature.get(i) < 2 && !coldCover.has(captured)) return "Tundra";
  if ((c.delta?.get(i) ?? 0) >= 0.5) return wetlandName(c.treeCover.get(i));
  return captured;
}
function climateCover(state: RefinementState, i: number): BiomeName {
  const c = state.surface.channels,
    t = c.temperature.get(i);
  if (t < 2) return "Tundra";
  if (c.wetlandCover.get(i) > 0.55) return wetlandName(c.treeCover.get(i));
  if (regionalMoisture(state, i) < 0.18) return "Desert";
  if (c.treeCover.get(i) < 0.3) return "Grassland";
  return forestName(c.treeCover.get(i), t, regionalMoisture(state, i));
}
function forestName(tree: number, temperature: number, moisture: number) {
  if (tree < 0.55) return "Woodland";
  if (temperature < 8) return "Boreal forest";
  return temperature > 23 && moisture > 0.7 ? "Rainforest" : "Temperate forest";
}
const wetlandName = (tree: number) => (tree > 0.5 ? ("Swamp" as const) : ("Marsh" as const));
/** Captured surfaces describing coarse water, channels or relief, which this map resolves itself. */
const resolvedSurfaces = new Set<NaturalSurfaceName>([
  "Ridge",
  "Lake",
  "Fjord",
  "Exposed shelf",
  "Shelf",
  "Ocean",
  "Reef",
  "Pack ice",
  "Sea ice",
  "Ice shelf",
  "Polynya",
  "Scree field",
  "River valley",
  "River channel",
  "Floodplain",
  "Delta",
  "Gorge",
  "Waterfall",
  "Current channel",
  "Trench",
  "Upwelling water",
  "Warm-water reach",
]);
function naturalName(
  state: RefinementState,
  i: number,
  biome: BiomeName,
  prior: number
): NaturalSurfaceName {
  const water = waterSurface(state, i, biome);
  if (water) return water;
  // As in initial geography, cover owns the surrounding land. A small stream
  // does not replace a whole resolved cell with wet-looking valley colour.
  if ((state.surface.channels.floodplain?.get(i) ?? 0) >= 0.25) return "Floodplain";
  return bareSurface(state, i) ?? landSurface(biome, naturalSurfaceNames[prior]);
}
/**
 * A cover this map imposed (new tundra, a coastal marsh) names its own surface;
 * otherwise the captured surface stays, unless it depicted coarse water or relief.
 */
function landSurface(biome: BiomeName, captured: NaturalSurfaceName | undefined) {
  const own = (naturalSurfaceNames as readonly string[]).includes(biome)
    ? (biome as NaturalSurfaceName)
    : null;
  if (own && resolvedCovers.has(biome) && captured !== biome) return own;
  if (captured && !resolvedSurfaces.has(captured)) return captured;
  return own ?? "Barren";
}
function waterSurface(state: RefinementState, i: number, biome: BiomeName) {
  if (biome === "Ocean")
    return state.surface.channels.waterDepth.get(i) < 150 ? ("Shelf" as const) : ("Ocean" as const);
  if (biome === "Freshwater") return "Lake" as const;
  if (biome === "Ice") return "Glacier" as const;
  return null;
}
function bareSurface(state: RefinementState, i: number): NaturalSurfaceName | null {
  const c = state.surface.channels;
  const bare = c.treeCover.get(i) + c.grassCover.get(i) + c.wetlandCover.get(i) < 0.12;
  if (bare && c.slope.get(i) >= 0.0235) return "Scree field";
  if (bare && [Landform.Ridge, Landform.Peak, Landform.Pass].includes(c.landform?.get(i) ?? 0))
    return "Ridge";
  return null;
}
function materialCode(state: RefinementState, i: number) {
  const c = state.surface.channels;
  if (c.water.get(i) === 1) return 6;
  if (c.water.get(i) === 2) return 3;
  if ((c.ice?.get(i) ?? 0) > 0.3) return 5;
  if (c.slope.get(i) > 0.15) return 0;
  return regionalMoisture(state, i) > 0.3 ? 3 : 2;
}
export function extractRegionalHabitats(state: RefinementState) {
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
    putRefinementFeature(state, `habitat:${kind}`, kind, "ecology", extent, { biome: kind });
  }
  g.coverage.release(labels);
}

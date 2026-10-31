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

/** Finer habitat patches follow soil/water variation over several resolved samples. */
const habitatSamples = 5;
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
/** Present cover responds locally; no ecological years or stock-renewal schedule are executed. */
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
    lakes = realizedLakeCells(state);
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      temperature = g.channels.temperature.get(i),
      moisture = regionalMoisture(state, i),
      patch = fractalNoise(
        p.x,
        p.y,
        state.input.seed ^ 0x4eaf,
        (g.scope.resolution ?? 1000) * habitatSamples,
        3
      ),
      wetness = regionalWetness(state, i),
      growth =
        clamp((temperature + 8) / 25) *
        clamp((moisture - 0.12) * 1.5) *
        clamp(g.channels.soilDepth.get(i) / 0.6),
      salting = g.channels.salting?.get(i) ?? 0,
      verdure = g.channels.verdure?.get(i) ?? 0;
    tree.set(
      i,
      clamp((growth * (0.7 + patch * 0.35) + tree.get(i) * 0.3 + verdure * 0.3) * (1 - salting))
    );
    wetland.set(i, clamp((wetness - 0.5) * 2));
    grass.set(i, clamp(growth * (1 - tree.get(i)) * 1.2));
    const name = coverName(state, i, lakes.get(i) > 0),
      code = biomeCode(name);
    biome.set(i, code);
    naturalTemp.set(i, temperature);
    const surface = naturalName(state, i, name);
    natural.set(i, surfaceCode(surface));
    final.set(i, natural.get(i));
    material.set(i, materialCode(state, i));
  }
  g.coverage.release(lakes);
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
function coverName(
  state: RefinementState,
  i: number,
  lake: boolean
): (typeof biomes)[number]["name"] {
  const c = state.surface.channels,
    t = c.temperature.get(i);
  if (c.water.get(i) === 1) return "Ocean";
  if (lake) return "Freshwater";
  if ((c.ice?.get(i) ?? 0) > 0.3) return "Ice";
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
function naturalName(
  state: RefinementState,
  i: number,
  biome: (typeof biomes)[number]["name"]
): NaturalSurfaceName {
  const c = state.surface.channels;
  if (biome === "Ocean") return c.waterDepth.get(i) < 150 ? "Shelf" : "Ocean";
  if (biome === "Freshwater") return "Lake";
  if (biome === "Ice") return "Glacier";
  // As in initial geography, cover owns the surrounding land. A small stream
  // does not replace a whole resolved cell with wet-looking valley colour.
  if ((c.floodplain?.get(i) ?? 0) >= 0.25) return "Floodplain";
  return bareSurface(state, i) ?? (biome as NaturalSurfaceName);
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

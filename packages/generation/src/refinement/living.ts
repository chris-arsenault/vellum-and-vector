import {
  biomeCode,
  biomes,
  fieldContour,
  classMarginInterpolator,
  gridPosition,
  surfaceCode,
  type NaturalSurfaceName,
} from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { channel, clamp, type RefinementState } from "./state";
import { gradient } from "./terrain";
import { putRefinementFeature } from "./features";

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
    runoff.set(i, Math.max(0, rain.get(i) * (0.25 + 0.45 * moisture.get(i))));
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
    naturalTemp = channel(state, "naturalTemperature", "celsius");
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      temperature = g.channels.temperature.get(i),
      moisture = g.channels.moisture.get(i),
      patch = fractalNoise(
        p.x,
        p.y,
        state.input.seed ^ 0x4eaf,
        (g.scope.resolution ?? 1000) * habitatSamples,
        3
      ),
      wetness = clamp(
        moisture +
          Math.log1p(g.channels.catchmentArea.get(i) / 1e6) * 0.04 -
          g.channels.slope.get(i) * 4
      ),
      growth =
        clamp((temperature + 8) / 25) *
        clamp((moisture - 0.12) * 1.5) *
        clamp(g.channels.soilDepth.get(i) / 0.6),
      salting = g.channels.salting?.get(i) ?? 0,
      verdure = g.channels.verdure?.get(i) ?? 0;
    tree.set(
      i,
      clamp((growth * 0.7 + tree.get(i) * 0.3 + patch * 0.35 + verdure * 0.3) * (1 - salting))
    );
    wetland.set(i, clamp((wetness - 0.65) * 3) * (g.channels.slope.get(i) < 0.015 ? 1 : 0.2));
    grass.set(i, clamp(growth * (1 - tree.get(i)) * 1.2));
    const name = coverName(state, i),
      code = biomeCode(name);
    biome.set(i, code);
    naturalTemp.set(i, temperature);
    const surface = naturalName(state, i, name);
    natural.set(i, surfaceCode(surface));
    final.set(i, natural.get(i));
    material.set(i, materialCode(state, i));
  }
}
function coverName(state: RefinementState, i: number): (typeof biomes)[number]["name"] {
  const c = state.surface.channels,
    t = c.temperature.get(i);
  if (c.water.get(i) === 1) return "Ocean";
  if (c.water.get(i) === 2) return "Freshwater";
  if ((c.ice?.get(i) ?? 0) > 0.3) return "Ice";
  if (t < 2) return "Tundra";
  if (c.moisture.get(i) < 0.18) return "Desert";
  if (c.wetlandCover.get(i) > 0.55) return wetlandName(c.treeCover.get(i));
  if (c.treeCover.get(i) < 0.3) return "Grassland";
  return forestName(c.treeCover.get(i), t, c.moisture.get(i));
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
  if (c.slope.get(i) > 0.15) return "Ridge";
  if (c.riverOrder.get(i) > 0) return "River valley";
  return biome as NaturalSurfaceName;
}
function materialCode(state: RefinementState, i: number) {
  const c = state.surface.channels;
  if (c.water.get(i) === 1) return 6;
  if (c.water.get(i) === 2) return 3;
  if ((c.ice?.get(i) ?? 0) > 0.3) return 5;
  if (c.slope.get(i) > 0.15) return 0;
  return c.moisture.get(i) > 0.3 ? 3 : 2;
}
export function extractRegionalHabitats(state: RefinementState) {
  const g = state.surface;
  const habitats = {
    forest: ["Woodland", "Temperate forest", "Boreal forest", "Rainforest"],
    wetland: ["Marsh", "Swamp", "Wet tundra"],
    grassland: ["Grassland", "Savanna", "Open field", "Cold steppe"],
  } as const;
  for (const [kind, names] of Object.entries(habitats)) {
    const codes = new Set(names.map((name) => surfaceCode(name))),
      at = classMarginInterpolator(g, "naturalSurface", (code) => codes.has(code)),
      shape = fieldContour(
        g,
        (x, y) => at({ x, y, z: 0 }),
        undefined,
        0,
        (g.scope.resolution ?? 1000) / 4,
        state.contours
      );
    if (shape)
      putRefinementFeature(state, `habitat:${kind}`, kind, "ecology", shape, { biome: kind });
  }
}

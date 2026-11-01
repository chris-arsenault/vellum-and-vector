import {
  biomeCode,
  biomes,
  gridPosition,
  surfaceCode,
  naturalSurfaceNames,
  type Band,
  type NaturalSurfaceName,
} from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { Landform } from "../canonry/codes";
import { regionalMoisture, regionalWetness } from "./climate";
import {
  channel,
  clamp,
  naturalChannel,
  regionalComponents,
  resolvesRegionalComponent,
  spacing,
  type RegionalState,
} from "./state";

type BiomeName = (typeof biomes)[number]["name"];

/** Prior share of a parent sample span that class boundaries are displaced, rounding its cell corners. */
const priorDisplacement = 0.45;
/** Temperature below which forest gives way to tundra: the tree line on new relief. */
const treeLine = 2;
/** Classes that are always valid to keep, even where new relief cools the ground. */
const coldCover = new Set<BiomeName>([
  "Tundra",
  "Ice",
  "Barren",
  "Rime forest",
  "Glow-lichen barrens",
]);
/** Classes this map's own relief and channels can impose on captured cover. */
const resolvedCovers = new Set<BiomeName>(["Tundra", "Marsh", "Swamp", "Grassland", "Woodland"]);
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

/**
 * The living landscape's response. The captured cover is the prior for what grows where;
 * each round re-reads the shared media (soil, slope, wetness, cold, magic) from their
 * captured copies, so a forest cell can open into valley meadow, a ridge can bare, high new
 * relief can pass the tree line, and the result is the same whether it is evaluated once or
 * three times. The developed cover binds hillslopes and holds runoff for the next round's
 * terrain and water.
 */
export function respondCover(state: RegionalState) {
  if (!state.input.domains.some((id) => id === "physical" || id === "magic")) return;
  const g = state.surface,
    tree = channel(state, "treeCover", "ratio"),
    grass = channel(state, "grassCover", "ratio"),
    wetland = channel(state, "wetlandCover", "ratio"),
    biome = channel(state, "biome", "category"),
    natural = channel(state, "naturalSurface", "category"),
    final = channel(state, "finalSurface", "category"),
    material = channel(state, "physicalMaterial", "category"),
    priorTree = naturalChannel(state, "treeCover", "ratio"),
    priorGrass = naturalChannel(state, "grassCover", "ratio"),
    priorWetland = naturalChannel(state, "wetlandCover", "ratio"),
    priorBiome = displacedPrior(state, naturalChannel(state, "biome", "category")),
    priorSurface = displacedPrior(state, naturalChannel(state, "naturalSurface", "category")),
    lakes = realizedLakeCells(state),
    applied = state.contributions;
  for (let i = 0; i < g.active.length; i++) {
    const temperature = g.channels.temperature.get(i),
      soil = clamp(0.55 + g.channels.soilDepth.get(i) / 1.2),
      steep = clamp(1 - (g.channels.slope.get(i) - 0.08) / 0.2),
      dryness = clamp(regionalMoisture(state, i) / 0.35),
      salting = g.channels.salting?.get(i) ?? 0,
      verdure = g.channels.verdure?.get(i) ?? 0,
      cold = clamp((temperature - treeLine) / 6);
    tree.set(
      i,
      clamp(
        (priorTree.get(i) * soil * steep * Math.min(1, 0.4 + dryness) * cold + verdure * 0.3) *
          (1 - salting)
      )
    );
    grass.set(i, clamp(priorGrass.get(i) * Math.max(steep, 0.4) * (1 - salting)));
    wetland.set(
      i,
      clamp(
        Math.max(priorWetland.get(i), (regionalWetness(state, i) - 0.5) * 2) +
          applied.appliedTo("wetlandCover", i)
      )
    );
    const name = coverName(state, i, lakes.get(i) > 0, priorBiome[i]);
    biome.set(i, biomeCode(name));
    natural.set(i, surfaceCode(naturalName(state, i, name, priorSurface[i])));
    // Magic cartography lays its own surfaces over this afterwards.
    final.set(i, natural.get(i));
    material.set(i, materialCode(state, i));
  }
  g.coverage.release(lakes);
}

/**
 * The captured class at a displaced position. Parent classes arrive as whole parent
 * samples; displacing the lookup turns their square corners into natural boundaries.
 */
function displacedPrior(state: RegionalState, band: Band) {
  const g = state.surface,
    [dx, dy] = spacing(g),
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

/** Standing water wide enough to resolve on this map; a submesh pond stays water context. */
function realizedLakeCells(state: RegionalState) {
  const g = state.surface,
    mask = g.coverage.scratch("uint8", "regional:realized-lakes", g.active.length);
  regionalComponents(
    g,
    (i) => g.channels.water.get(i) === 2,
    (members) => {
      if (!resolvesRegionalComponent(g, members)) return;
      for (const i of members) mask.set(i, 1);
    }
  );
  return mask;
}

function coverName(state: RegionalState, i: number, lake: boolean, prior: number): BiomeName {
  const c = state.surface.channels,
    captured = biomes[prior]?.name;
  if (c.water.get(i) === 1) return "Ocean";
  if (lake) return "Freshwater";
  if ((c.ice?.get(i) ?? 0) > 0.3) return "Ice";
  // Land the captured map held as water, or never classified, takes its climate's cover.
  if (!captured || ["Unclassified", "Ocean", "Freshwater"].includes(captured))
    return climateCover(state, i);
  return developedCover(state, i, captured);
}
/**
 * How the captured class develops under local conditions: the tree line, delta and valley
 * wetlands, and the opening of forest where soil, slope or dryness no longer carry trees.
 */
function developedCover(state: RegionalState, i: number, captured: BiomeName): BiomeName {
  const c = state.surface.channels,
    tree = c.treeCover.get(i);
  if (c.temperature.get(i) < treeLine && !coldCover.has(captured)) return "Tundra";
  if ((c.delta?.get(i) ?? 0) >= 0.5) return wetlandName(tree);
  if (c.wetlandCover.get(i) > 0.55 && !coldCover.has(captured)) return wetlandName(tree);
  const forest = ["Temperate forest", "Boreal forest", "Rainforest", "Woodland"].includes(captured);
  if (forest && tree < 0.12) return "Grassland";
  if (forest && captured !== "Woodland" && tree < 0.3) return "Woodland";
  return captured;
}
function climateCover(state: RegionalState, i: number): BiomeName {
  const c = state.surface.channels,
    t = c.temperature.get(i);
  if (t < treeLine) return "Tundra";
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
  state: RegionalState,
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
 * A cover this map developed (new tundra, a valley meadow, a coastal marsh) names its own
 * surface; otherwise the captured surface stays, unless it depicted coarse water or relief.
 */
function landSurface(biome: BiomeName, captured: NaturalSurfaceName | undefined) {
  const own = (naturalSurfaceNames as readonly string[]).includes(biome)
    ? (biome as NaturalSurfaceName)
    : null;
  if (own && resolvedCovers.has(biome) && captured !== biome) return own;
  if (captured && !resolvedSurfaces.has(captured)) return captured;
  return own ?? "Barren";
}
function waterSurface(state: RegionalState, i: number, biome: BiomeName) {
  if (biome === "Ocean")
    return state.surface.channels.waterDepth.get(i) < 150 ? ("Shelf" as const) : ("Ocean" as const);
  if (biome === "Freshwater") return "Lake" as const;
  if (biome === "Ice") return "Glacier" as const;
  return null;
}
function bareSurface(state: RegionalState, i: number): NaturalSurfaceName | null {
  const c = state.surface.channels;
  const bare = c.treeCover.get(i) + c.grassCover.get(i) + c.wetlandCover.get(i) < 0.12;
  if (bare && c.slope.get(i) >= 0.0235) return "Scree field";
  if (bare && [Landform.Ridge, Landform.Peak, Landform.Pass].includes(c.landform?.get(i) ?? 0))
    return "Ridge";
  return null;
}
function materialCode(state: RegionalState, i: number) {
  const c = state.surface.channels;
  if (c.water.get(i) === 1) return 6;
  if (c.water.get(i) === 2) return 3;
  if ((c.ice?.get(i) ?? 0) > 0.3) return 5;
  if (c.slope.get(i) > 0.15) return 0;
  return regionalMoisture(state, i) > 0.3 ? 3 : 2;
}

import { biomeCode, biomes } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { celsius, regionalMoisture, regionalWetness } from "./climate";
import { components, isContent, regionalSpan, resolvesComponent } from "./lattice";
import { clamp, naturalBand, type RegionalState } from "./state";

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

/**
 * The living landscape's response. The captured cover is the prior for what grows where;
 * each round re-reads the shared media (soil, slope, wetness, cold, magic) from their
 * captured copies, so a forest cell can open into valley meadow, a ridge can bare, high new
 * relief can pass the tree line, and the result is the same whether it is evaluated once or
 * three times. The developed cover binds hillslopes and holds runoff for the next round's
 * terrain and water. Cover bands are the field's own (ratios); the biome is its code.
 */
export function respondCover(state: RegionalState) {
  if (!state.regional.input.domains.some((id) => id === "physical" || id === "magic")) return;
  const map = state.physical.map,
    mesh = map.mesh,
    priorTree = naturalBand(state, "TreeCover"),
    priorGrass = naturalBand(state, "GrassCover"),
    priorWetland = naturalBand(state, "WetlandCover"),
    priorBiome = displacedPrior(state, naturalBand(state, "BiomeCodes")),
    lakes = realizedLakeCells(state),
    applied = state.regional.contributions;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const temperature = celsius(state, i),
      soil = clamp(0.55 + map.SoilDepth.get(i) / 1.2),
      steep = clamp(1 - (map.Slope.get(i) - 0.08) / 0.2),
      dryness = clamp(regionalMoisture(state, i) / 0.35),
      salting = map.Salting.get(i),
      verdure = map.Verdure.get(i),
      cold = clamp((temperature - treeLine) / 6);
    map.TreeCover.set(
      i,
      clamp(
        (priorTree.get(i) * soil * steep * Math.min(1, 0.4 + dryness) * cold + verdure * 0.3) *
          (1 - salting) +
          applied.appliedTo("TreeCover", i)
      )
    );
    map.GrassCover.set(
      i,
      clamp(
        priorGrass.get(i) * Math.max(steep, 0.4) * (1 - salting) +
          applied.appliedTo("GrassCover", i)
      )
    );
    // Greenwood divides the river that crosses it into wetland channels: the braided reach.
    const braided = verdure > 0.3 && map.RiverOrders.get(i) >= 1 ? 0.5 * verdure : 0;
    map.WetlandCover.set(
      i,
      clamp(
        Math.max(priorWetland.get(i), (regionalWetness(state, i) - 0.5) * 2, braided) +
          applied.appliedTo("WetlandCover", i)
      )
    );
    map.BiomeCodes.set(i, biomeCode(coverName(state, i, lakes[i] > 0, priorBiome[i])));
  }
}

/**
 * The captured class at a displaced position. Parent classes arrive as whole parent
 * samples; displacing the lookup turns their square corners into natural boundaries.
 */
function displacedPrior(state: RegionalState, band: { get(i: number): number }) {
  const mesh = state.physical.map.mesh,
    span = state.regional.parentSpan,
    reach = span * priorDisplacement,
    prior = new Int32Array(mesh.count);
  for (let i = 0; i < prior.length; i++) {
    const x = mesh.x(i),
      y = mesh.y(i),
      px = x + mesh.origin[0],
      py = y + mesh.origin[1],
      ox = fractalNoise(px, py, state.regional.input.seed ^ 0x2b71, span, 3) * reach,
      oy = fractalNoise(px, py, state.regional.input.seed ^ 0x6d19, span, 3) * reach,
      j = mesh.cellAt(x + ox, y + oy);
    prior[i] = band.get(j < 0 ? i : j);
  }
  return prior;
}

/** Standing water wide enough to resolve on this map; a submesh pond stays water context. */
function realizedLakeCells(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    mask = new Uint8Array(mesh.count);
  components(
    mesh,
    (i) => map.WaterKindCodes.get(i) === 2,
    (members) => {
      if (!resolvesComponent(mesh, members, regionalSpan(state))) return;
      for (const i of members) mask[i] = 1;
    }
  );
  return mask;
}

function coverName(state: RegionalState, i: number, lake: boolean, prior: number): BiomeName {
  const map = state.physical.map,
    captured = biomes[prior]?.name;
  if (map.WaterKindCodes.get(i) === 1) return "Ocean";
  if (lake) return "Freshwater";
  if (map.IceThickness.get(i) > 300) return "Ice";
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
  const map = state.physical.map,
    tree = map.TreeCover.get(i),
    warm = !coldCover.has(captured);
  if (warm && celsius(state, i) < treeLine) return "Tundra";
  if (map.DeltaIntensity.get(i) >= 500 || (warm && map.WetlandCover.get(i) > 0.55))
    return wetlandName(tree);
  return openedForest(captured, tree);
}
/** Forest opens into woodland and grassland where the cover no longer carries trees. */
function openedForest(captured: BiomeName, tree: number): BiomeName {
  if (!["Temperate forest", "Boreal forest", "Rainforest", "Woodland"].includes(captured))
    return captured;
  if (tree < 0.12) return "Grassland";
  return captured !== "Woodland" && tree < 0.3 ? "Woodland" : captured;
}
function climateCover(state: RegionalState, i: number): BiomeName {
  const map = state.physical.map,
    t = celsius(state, i);
  if (t < treeLine) return "Tundra";
  if (map.WetlandCover.get(i) > 0.55) return wetlandName(map.TreeCover.get(i));
  if (regionalMoisture(state, i) < 0.18) return "Desert";
  if (map.TreeCover.get(i) < 0.3) return "Grassland";
  return forestName(map.TreeCover.get(i), t, regionalMoisture(state, i));
}
function forestName(tree: number, temperature: number, moisture: number) {
  if (tree < 0.55) return "Woodland";
  if (temperature < 8) return "Boreal forest";
  return temperature > 23 && moisture > 0.7 ? "Rainforest" : "Temperate forest";
}
const wetlandName = (tree: number) => (tree > 0.5 ? ("Swamp" as const) : ("Marsh" as const));

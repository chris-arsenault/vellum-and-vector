import { biomes, SmallIntSet, spatial, type Band } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import type { GenerationState } from "../process";
import { components, publishPlace } from "./geographicRegions";
import type { Geometry } from "geojson";
import { combinedContour, fillSmallHoles } from "./geographicContours";
import { biomeRules, type BiomeRule, type BiomeSummary } from "./ecologyBiomes";
import { largestRegionFactor, landArea, partitionRegion } from "./regionPartition";
import type { RegionMembers } from "./regionMembers";
import { isWorldGeography } from "../worldSignificance";
import { extractWorldEcologicalFeatures } from "./worldEcologyFeatures";

type Term = (i: number) => number;
const families: Record<string, string> = {
  Barren: "barren",
  Desert: "barren",
  Tundra: "grassland",
  Grassland: "grassland",
  Savanna: "grassland",
  Woodland: "forest",
  "Temperate forest": "forest",
  "Boreal forest": "forest",
  Rainforest: "forest",
  Marsh: "wetland",
  Swamp: "wetland",
  "Ember grove": "ember",
  "Thaw meadow": "thaw",
  "Rime forest": "rime",
  "Glow-lichen barrens": "glow",
  "Fog heath": "fog",
  "Moss forest": "fog",
  Deepwood: "deepwood",
  "Barrow heath": "barrow",
  "Salt pan": "pan",
  "Glass flat": "flat",
  "Wending fen": "wending",
  "Well meadow": "well",
};
/** Authored biome samples decide their cells outright: positive for their family's rule only. */
function authoredTerms(state: GenerationState, rule: BiomeRule): Term[] {
  const fixed = state.physical!.fixed.find(({ binding }) => binding.native === "BiomeCodes");
  if (!fixed) return rule.terms;
  const values = fixed.values;
  return rule.terms.map((term) => (i) => {
    const value = values.get(i);
    if (!Number.isFinite(value)) return term(i);
    return families[biomes[value]?.name ?? ""] === rule.kind ? 1 : -1;
  });
}
/**
 * Dry, ice-free land as the per-cell quantities the ocean and lake outlines trace: the sea's
 * signed depth, and each lake's depth below its level with its body membership.
 */
function waterTerms(state: GenerationState): { terms: Term[]; dry: (v: number[]) => number } {
  const map = state.physical!.map,
    mesh = map.mesh,
    level = workingArray(map, "float64", "biome:lake-level").fill(NaN),
    body = workingArray(map, "int32", "biome:water-body").fill(-1),
    front = workingArray(map, "int32", "biome:lake-front");
  let tail = 0;
  for (let i = 0; i < mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 2) {
      level.set(i, map.WaterSurfaceElevations.get(i));
      body.set(i, map.WaterBodyIds.get(i));
      front.set(tail++, i);
    }
  // A lake's shoreline samples average its neighbours; carry its level past that support.
  for (let ring = 0, start = 0; ring < 3; ring++) {
    const end = tail;
    for (let at = start; at < end; at++) {
      const i = front.get(at);
      for (let edge = 0; edge < mesh.degree(i); edge++) {
        const j = mesh.neighbor(i, edge);
        if (j < 0 || body.get(j) >= 0) continue;
        level.set(j, level.get(i));
        body.set(j, body.get(i));
        front.set(tail++, j);
      }
    }
    start = end;
  }
  releaseWorking(map, front);
  const depth = (i: number) => map.EffectiveSeaLevel - map.Elevation.get(i);
  return {
    terms: [
      (i) => -(map.WaterKindCodes.get(i) === 1 ? depth(i) : -Math.abs(depth(i))) / 102_400,
      (i) => 1 - map.IceThickness.get(i),
      (i) => {
        const held = level.get(i);
        return Number.isNaN(held) ? 1 : (map.Elevation.get(i) - held) / 102_400;
      },
      (i) => {
        const held = body.get(i);
        return held >= 0 && map.WaterBodyIds.get(i) === held ? 1 : 0;
      },
    ],
    dry: ([sea, ice, lake, lakeMember]) =>
      Math.min(sea, ice, Math.max(lake, (0.1 - lakeMember) * 1000)),
  };
}
function summarize(
  state: GenerationState,
  members: RegionMembers,
  biome: ReturnType<typeof biomeRules>
) {
  const map = state.physical!.map,
    area = (i: number) => map.mesh.area(i),
    total = members.reduce((sum, i) => sum + area(i), 0),
    mean = (value: Term) => members.reduce((sum, i) => sum + value(i) * area(i), 0) / total;
  const systems = new Map<string, number>();
  for (const field of state.physical!.magic?.fields ?? [])
    if (field.definition.enabled)
      systems.set(
        field.definition.id,
        mean((i) => field.intensity.get(i))
      );
  return {
    broadleaf: mean((i) => map.BroadleafCover.get(i)),
    conifer: mean((i) => map.ConiferCover.get(i)),
    grass: mean((i) => map.GrassCover.get(i)),
    wetland: mean((i) => map.WetlandCover.get(i)),
    fire: mean((i) => map.FireActivity.get(i)),
    flood: mean((i) => map.FloodFrequency.get(i)),
    peat: mean((i) => map.PeatCarbon.get(i)),
    temperature: mean((i) => biome.temperature.get(i)),
    moisture: mean((i) => biome.moisture.get(i)),
    wetness: mean((i) => biome.wetness.get(i)),
    slope: mean((i) => map.Slope.get(i)),
    elevation: mean((i) => (map.Elevation.get(i) - map.BaseSeaLevel) / 1024),
    systems,
  } satisfies BiomeSummary;
}
/**
 * A rule's traced quantity: all of its own terms positive, no higher rule holding, and dry.
 * Each piece is a term interpolated on its own, so neighbours share their crossings.
 */
function ruleQuantity(
  state: GenerationState,
  rules: BiomeRule[],
  index: number,
  water: ReturnType<typeof waterTerms>
) {
  const groups = rules.slice(0, index + 1).map((rule) => authoredTerms(state, rule));
  const terms = [...groups.flat(), ...water.terms],
    offsets = groups.map((_, g) => groups.slice(0, g).reduce((n, group) => n + group.length, 0));
  const combine = (values: number[]) => {
    let result = water.dry(values.slice(values.length - water.terms.length));
    for (let g = 0; g < groups.length; g++) {
      const part = values.slice(offsets[g], offsets[g] + groups[g].length);
      result = Math.min(result, g === index ? Math.min(...part) : Math.max(...part.map((v) => -v)));
    }
    return result;
  };
  const at = (i: number) => combine(terms.map((term) => term(i)));
  return { terms, combine, at };
}
/**
 * Named biomes are large contiguous regions of one rule, outlined in generation from the cover
 * or magic quantity that defines them. Continuous cover remains the ecological representation.
 */
export function extractEcologicalFeatures(state: GenerationState) {
  if (isWorldGeography(state)) return extractWorldEcologicalFeatures(state, families, summarize);
  const map = state.physical!.map,
    biome = biomeRules(state),
    water = waterTerms(state),
    land = landArea(state),
    // Published pieces by cell; another piece inside a gap keeps its own outline.
    claimed = workingArray(map, "int32", "biome:claimed").fill(-1);
  let serial = 0;
  biome.rules.forEach((rule, index) => {
    const quantity = ruleQuantity(state, biome.rules, index, water),
      minimum = rule.share * land;
    const inside = workingValues(map, "float64", "biome:inside", quantity.at);
    components(
      state,
      (i) => inside.get(i) > 0,
      (members) => {
        const area = members.reduce((sum, i) => sum + map.mesh.contentArea(i), 0);
        if (area < minimum) return;
        // A region beyond a few times the least named size splits along drainage divides.
        const pieces = partitionRegion(state, members, minimum * largestRegionFactor);
        pieces.forEach((piece, n) => piece.forEach((i) => claimed.set(i, serial + n)));
        pieces.forEach((piece, n) => {
          const own = serial + n;
          const blocks = (i: number) => {
            const held = claimed.get(i);
            return (
              map.WaterKindCodes.get(i) !== 0 ||
              map.IceThickness.get(i) >= 1 ||
              (held >= 0 && held !== own)
            );
          };
          const sibling = (label: number) => label >= serial && label < serial + pieces.length;
          publishBiome(
            state,
            rule,
            piece,
            pieceTerms(state, claimed, piece, own, sibling),
            quantity,
            {
              region: summarize(state, piece, biome),
              fill: (shape) => fillSmallHoles(state, shape, minimum, blocks),
            }
          );
        });
        serial += pieces.length;
      }
    );
    releaseWorking(map, inside);
  });
  releaseWorking(map, claimed, biome.temperature, biome.moisture, biome.wetness);
}
/**
 * Indicators of a piece and of each sibling piece it touches. Combined at every sample as the
 * piece's share less the largest sibling share, they meet at zero along shared midlines and at
 * the points where three pieces meet, so pieces tile their region without gaps or overlap.
 */
function pieceTerms(
  state: GenerationState,
  claimed: Band,
  piece: RegionMembers,
  own: number,
  sibling: (label: number) => boolean
) {
  const mesh = state.physical!.map.mesh,
    siblings = new SmallIntSet();
  for (const i of piece)
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0) continue;
      const held = claimed.get(j);
      if (held !== own && sibling(held)) siblings.add(held);
    }
  return [own, ...siblings.items()].map((label) => (i: number) => Number(claimed.get(i) === label));
}
function publishBiome(
  state: GenerationState,
  rule: BiomeRule,
  members: RegionMembers,
  pieces: ((cell: number) => number)[],
  quantity: ReturnType<typeof ruleQuantity>,
  { region, fill }: { region: BiomeSummary; fill: (shape: Geometry) => Geometry }
) {
  // Outside every piece the share floor of 0.1 leaves the cover quantity to draw the outline.
  const count = quantity.terms.length,
    shape = combinedContour(state, members, [...quantity.terms, ...pieces], (values) => {
      const [own, ...others] = values.slice(count);
      return Math.min(quantity.combine(values.slice(0, count)), own - Math.max(0.1, ...others));
    });
  // A gap smaller than this rule's least named region could never be named on its own.
  const extent = shape && spatial.intersection(fill(shape), state.domain.scope.footprint);
  if (!extent) return;
  const name = rule.name(region);
  publishPlace(
    state,
    rule.kind,
    name,
    members,
    "ecology",
    {
      sourceAlgorithm: "atlas-biomes-1",
      biome: name,
      system: rule.system?.(region) ?? null,
      treeCover: region.broadleaf + region.conifer,
      grassCover: region.grass,
      wetlandCover: region.wetland,
      temperature: region.temperature,
      moisture: region.moisture,
    },
    extent
  );
}

import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { environment } from "./ecologyEnvironment";
import { workingArray } from "./physicalNumerics";

/** Area-weighted means over a biome region; they name the region, never shape it. */
export interface BiomeSummary {
  broadleaf: number;
  conifer: number;
  grass: number;
  wetland: number;
  fire: number;
  flood: number;
  peat: number;
  temperature: number;
  moisture: number;
  wetness: number;
  slope: number;
  elevation: number;
  systems: Map<string, number>;
}
/**
 * One named biome: where every term is positive, outlined from one cover or magic quantity.
 * Terms are per-cell quantities in their own units; only their zero crossings matter.
 */
export interface BiomeRule {
  kind: string;
  share: number;
  terms: ((i: number) => number)[];
  name: (region: BiomeSummary) => string;
  system?: (region: BiomeSummary) => string | undefined;
}
type Systems = NonNullable<NonNullable<GenerationState["physical"]>["magic"]>["fields"];

/** The enabled system with the strongest mean intensity among those with an effect. */
function strongest(fields: Systems, region: BiomeSummary) {
  let best: string | undefined,
    peak = 0;
  for (const field of fields) {
    const intensity = region.systems.get(field.definition.id) ?? 0;
    if (intensity > peak) [best, peak] = [field.definition.id, intensity];
  }
  return best;
}
/**
 * Living landscapes made by a system's own forcing: quickened country, stilled country and
 * fog coasts. Each region is outlined from the forcing and the cover it produced, and named
 * for the strongest system that carries that effect.
 */
function magicRules(state: GenerationState): BiomeRule[] {
  const work = state.physical!,
    map = work.map,
    fields = (work.magic?.fields ?? []).filter((field) => field.definition.enabled);
  const quickening = fields.filter((f) => f.definition.effects.quickening > 0),
    stilling = fields.filter((f) => f.definition.effects.stillness > 0),
    fogging = fields.filter((f) => f.definition.effects.fog > 0);
  const canopy = (i: number) => map.BroadleafCover.get(i) + map.ConiferCover.get(i),
    cover = (i: number) => map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i);
  const rules: BiomeRule[] = [];
  if (quickening.length)
    rules.push(
      {
        kind: "ember",
        share: 0.0003,
        terms: [(i) => map.Quickening.get(i) - 0.25, (i) => canopy(i) - 0.3],
        name: () => "Ember grove",
        system: (r) => strongest(quickening, r),
      },
      {
        kind: "thaw",
        share: 0.0003,
        terms: [
          (i) => map.Quickening.get(i) - 0.25,
          (i) => 0.3 - canopy(i),
          (i) => cover(i) - 0.12,
        ],
        name: () => "Thaw meadow",
        system: (r) => strongest(quickening, r),
      }
    );
  if (stilling.length)
    rules.push(
      {
        kind: "rime",
        share: 0.0003,
        terms: [(i) => map.Stillness.get(i) - 0.45, (i) => canopy(i) - 0.3],
        name: () => "Rime forest",
        system: (r) => strongest(stilling, r),
      },
      {
        kind: "glow",
        share: 0.0003,
        terms: [(i) => map.Stillness.get(i) - 0.45, (i) => 0.12 - cover(i)],
        name: () => "Glow-lichen barrens",
        system: (r) => strongest(stilling, r),
      }
    );
  if (fogging.length)
    rules.push({
      kind: "fog",
      share: 0.0003,
      terms: [(i) => map.FogForcing.get(i) - 0.3, (i) => cover(i) - 0.12],
      name: (r) => (r.broadleaf + r.conifer >= 0.4 ? "Moss forest" : "Fog heath"),
      system: (r) => strongest(fogging, r),
    });
  const greening = fields.filter((f) => f.definition.effects.verdure > 0);
  if (greening.length) rules.push(...verdantRules(map, greening, canopy, cover));
  const salting = fields.filter((f) => f.definition.effects.salting > 0);
  if (salting.length) rules.push(...saltRules(map, salting, cover));
  return rules;
}
/** Salt's country: the fused flat first, then the bare pan, then the heath on a killing ground. */
function saltRules(
  map: PhysicalField,
  salting: Systems,
  cover: (i: number) => number
): BiomeRule[] {
  const system = (r: BiomeSummary) => strongest(salting, r);
  return [
    {
      kind: "flat",
      share: 0.0003,
      terms: [
        (i) => map.Salting.get(i) - 0.3,
        (i) => map.RockResistance.get(i) - 950,
        (i) => 0.12 - cover(i),
      ],
      name: () => "Glass flat",
      system,
    },
    {
      kind: "pan",
      share: 0.0003,
      terms: [(i) => map.Salting.get(i) - 0.3, (i) => 0.12 - cover(i)],
      name: () => "Salt pan",
      system,
    },
    {
      kind: "barrow",
      share: 0.0003,
      terms: [(i) => map.Salting.get(i) - 0.3, (i) => cover(i) - 0.12],
      name: () => "Barrow heath",
      system,
    },
  ];
}
/** Greenwood's country: the Deepwood, the fen a river braids through it, the meadow at a spring. */
function verdantRules(
  map: PhysicalField,
  greening: Systems,
  canopy: (i: number) => number,
  cover: (i: number) => number
): BiomeRule[] {
  const system = (r: BiomeSummary) => strongest(greening, r);
  return [
    {
      kind: "deepwood",
      share: 0.0003,
      terms: [(i) => map.Verdure.get(i) - 0.3, (i) => canopy(i) - 0.5],
      name: () => "Deepwood",
      system,
    },
    {
      kind: "wending",
      share: 0.0003,
      terms: [(i) => map.Verdure.get(i) - 0.3, (i) => map.WetlandCover.get(i) - 0.3],
      name: () => "Wending fen",
      system,
    },
    {
      kind: "well",
      share: 0.0003,
      terms: [(i) => map.Verdure.get(i) - 0.3, (i) => 0.5 - canopy(i), (i) => cover(i) - 0.12],
      name: () => "Well meadow",
      system,
    },
  ];
}
function forestName(r: BiomeSummary) {
  const conifer = r.conifer / Math.max(1e-9, r.conifer + r.broadleaf);
  if (conifer > 0.6)
    return r.temperature < 5
      ? "Boreal forest"
      : r.elevation > 1500
        ? "Montane forest"
        : "Conifer forest";
  if (conifer > 0.4) return "Mixed forest";
  if (r.temperature > 22 && r.moisture > 0.7) return "Rainforest";
  return r.temperature > 18 ? "Dry forest" : "Temperate forest";
}
function grassName(r: BiomeSummary) {
  if (r.temperature < 2) return "Tundra";
  // Savanna is fire-kept grass; warm wet-season grassland stands in while fire is unsimulated.
  if (r.temperature > 18 && (r.fire > 0.2 || r.moisture > 0.3)) return "Savanna";
  return r.moisture < 0.3 ? "Steppe" : "Prairie";
}
function wetlandName(r: BiomeSummary) {
  if (r.peat >= 10) return "Bog";
  if (r.flood > 0.1) return "Floodplain marsh";
  return r.broadleaf + r.conifer > 0.2 ? "Swamp" : "Marsh";
}
function barrenName(r: BiomeSummary) {
  if (r.temperature < 2) return "Polar desert";
  if (r.slope > 0.015 || r.elevation > 2000) return "Rock barrens";
  return r.temperature > 18 ? "Hot desert" : "Cold desert";
}
/** Named biomes in priority order; a region belongs to the first rule that holds. */
export function biomeRules(state: GenerationState) {
  const map = state.physical!.map,
    count = map.mesh.count,
    temperature = workingArray(map, "float64", "biome:temperature"),
    moisture = workingArray(map, "float64", "biome:moisture"),
    wetness = workingArray(map, "float64", "biome:wetness");
  for (let i = 0; i < count; i++) {
    const e = environment(map, i);
    temperature.set(i, e.temperature);
    moisture.set(i, e.moisture);
    wetness.set(i, e.wetness);
  }
  const cover = (i: number) =>
    map.BroadleafCover.get(i) +
    map.ConiferCover.get(i) +
    map.GrassCover.get(i) +
    map.WetlandCover.get(i);
  const rules: BiomeRule[] = [
    ...magicRules(state),
    {
      kind: "wetland",
      share: 0.001,
      terms: [(i) => map.WetlandCover.get(i) - 0.3],
      name: wetlandName,
    },
    {
      kind: "forest",
      share: 0.004,
      terms: [(i) => map.BroadleafCover.get(i) + map.ConiferCover.get(i) - 0.4],
      name: forestName,
    },
    // Open grass meets barren land near the same total cover, so the two share an edge.
    {
      kind: "grassland",
      share: 0.004,
      terms: [(i) => map.GrassCover.get(i) - 0.15],
      name: grassName,
    },
    { kind: "barren", share: 0.004, terms: [(i) => 0.12 - cover(i)], name: barrenName },
  ];
  return { rules, temperature, moisture, wetness };
}

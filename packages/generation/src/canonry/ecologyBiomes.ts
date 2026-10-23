import type { GenerationState } from "../process";
import { environment } from "./ecologyEnvironment";

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
/** Systems whose rules alter vegetation or burn it, so their biomes follow their own effects. */
function magicRules(state: GenerationState, temperature: Float64Array): BiomeRule[] {
  const work = state.physical!,
    map = work.map,
    fields = (work.magic?.fields ?? []).filter((field) => field.definition.enabled),
    named = (id?: string) => fields.find((f) => f.definition.id === id)?.definition.name ?? "";
  const altering = fields.filter((f) => f.definition.effects.ecologicalAlteration > 0),
    burning = fields.filter((f) => f.definition.effects.fire > 0),
    heating = fields.filter((f) => f.definition.effects.heat > 0);
  const fire = (i: number) =>
      burning.reduce((sum, f) => sum + (f.intensity[i] / 1000) * f.definition.effects.fire, 0),
    // Applied magical warming in °C; climate already includes it in the temperature.
    heat = (i: number) => (work.magic?.heat[i] ?? 0) / 10;
  const rules: BiomeRule[] = [];
  if (altering.length)
    rules.push({
      kind: "altered",
      share: 0.0005,
      terms: [(i) => map.AlteredCover[i] + map.AlteredSaplings[i] - 0.2],
      name: (r) =>
        `${named(strongest(altering, r))}-altered ${r.wetness > 0.5 ? "wetland" : "woodland"}`,
      system: (r) => strongest(altering, r),
    });
  // Fire's fire effect sets a floor under burning, so grass holds along its veins.
  if (burning.length)
    rules.push({
      kind: "ember",
      share: 0.0005,
      terms: [(i) => fire(i) - 0.25, (i) => map.GrassCover[i] - 0.3],
      name: () => "Ember grassland",
      system: (r) => strongest(burning, r),
    });
  // Ground above freezing only because of magical heat.
  if (heating.length)
    rules.push({
      kind: "thaw",
      share: 0.001,
      terms: [(i) => (temperature[i] - 2) / 10, (i) => (2 - temperature[i] + heat(i)) / 10],
      name: (r) =>
        r.broadleaf + r.conifer >= 0.4
          ? "Thaw forest"
          : r.grass >= 0.4
            ? "Thaw meadow"
            : "Thaw ground",
      system: (r) => strongest(heating, r),
    });
  return rules;
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
    temperature = new Float64Array(count),
    moisture = new Float64Array(count),
    wetness = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const e = environment(map, i);
    [temperature[i], moisture[i], wetness[i]] = [e.temperature, e.moisture, e.wetness];
  }
  const cover = (i: number) =>
    map.BroadleafCover[i] +
    map.ConiferCover[i] +
    map.GrassCover[i] +
    map.WetlandCover[i] +
    map.AlteredCover[i];
  const rules: BiomeRule[] = [
    ...magicRules(state, temperature),
    {
      kind: "wetland",
      share: 0.001,
      terms: [(i) => map.WetlandCover[i] - 0.3],
      name: wetlandName,
    },
    {
      kind: "forest",
      share: 0.004,
      terms: [(i) => map.BroadleafCover[i] + map.ConiferCover[i] - 0.4],
      name: forestName,
    },
    // Open grass meets barren land near the same total cover, so the two share an edge.
    { kind: "grassland", share: 0.004, terms: [(i) => map.GrassCover[i] - 0.15], name: grassName },
    { kind: "barren", share: 0.004, terms: [(i) => 0.12 - cover(i)], name: barrenName },
  ];
  return { rules, temperature, moisture, wetness };
}

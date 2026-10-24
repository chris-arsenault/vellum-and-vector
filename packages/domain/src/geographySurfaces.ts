export const naturalSurfaceNames = [
  "Tundra",
  "Open field",
  "Ridge",
  "Glacier",
  "Moraine",
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
  "Snowfield",
  "Polar barrens",
  "Wet tundra",
  "Cold steppe",
  "Scree field",
  "River valley",
  "River channel",
  "Floodplain",
  "Delta",
  "Gorge",
  "Waterfall",
  "Current channel",
  "Trench",
  "Grassland",
  "Savanna",
  "Woodland",
  "Temperate forest",
  "Boreal forest",
  "Rainforest",
  "Marsh",
  "Swamp",
  "Desert",
  "Barren",
  "Ember grove",
  "Thaw meadow",
  "Rime forest",
  "Glow-lichen barrens",
  "Fog heath",
  "Moss forest",
  "Upwelling water",
  "Warm-water reach",
] as const;
export const surfaceCode = (name: (typeof naturalSurfaceNames)[number]) =>
  naturalSurfaceNames.indexOf(name);
export type NaturalSurfaceName = (typeof naturalSurfaceNames)[number];

/** Biome-named surfaces share the biome colours; relief and ice surfaces have their own. */
export const naturalSurfaceColors: Record<NaturalSurfaceName, string> = {
  Tundra: "#a4b19a",
  "Open field": "#b9bf86",
  Ridge: "#a89f93",
  Glacier: "#dfe9ec",
  Moraine: "#b1a994",
  Lake: "#83b6c5",
  Fjord: "#6fa3b4",
  "Exposed shelf": "#c8c2a8",
  Shelf: "#7fb0bf",
  Ocean: "#397d99",
  Reef: "#7fc1b0",
  "Pack ice": "#e8eff1",
  "Sea ice": "#d9e6ea",
  "Ice shelf": "#e2ede8",
  Polynya: "#5f97aa",
  Snowfield: "#eef2ee",
  "Polar barrens": "#c4bfb0",
  "Wet tundra": "#8fa89a",
  "Cold steppe": "#b8b98a",
  "Scree field": "#a69c90",
  "River valley": "#9bb58a",
  "River channel": "#86b3a8",
  Floodplain: "#a7bc8c",
  Delta: "#9cc0a8",
  Gorge: "#8c7f73",
  Waterfall: "#9fd0e3",
  "Current channel": "#4f8fa6",
  Trench: "#2a5f78",
  Grassland: "#afbd74",
  Savanna: "#c0b76a",
  Woodland: "#7eaa66",
  "Temperate forest": "#4f8d55",
  "Boreal forest": "#527c68",
  Rainforest: "#28674c",
  Marsh: "#83a794",
  Swamp: "#547c69",
  Desert: "#ddc78d",
  Barren: "#b5a58c",
  "Ember grove": "#6f9f3c",
  "Thaw meadow": "#a9c86f",
  "Rime forest": "#7d98a4",
  "Glow-lichen barrens": "#b9d4d6",
  "Fog heath": "#9db3a1",
  "Moss forest": "#4e8470",
  "Upwelling water": "#3f8fa8",
  "Warm-water reach": "#7fc29a",
};
/** Water surfaces whose depth shading says more than a flat class colour. */
const bathymetricSurfaces: ReadonlySet<NaturalSurfaceName> = new Set<NaturalSurfaceName>([
  "Lake",
  "Fjord",
  "Exposed shelf",
  "Shelf",
  "Ocean",
  "Current channel",
  "Trench",
  "Delta",
  "Upwelling water",
]);

export type MagicPlaceSymbol = "circle" | "square" | "diamond" | "triangle" | "star" | "cross";
export interface MagicPlacePresentation {
  color: string;
  symbol: MagicPlaceSymbol;
  /**
   * Share of the class colour drawn over the terrain base, 0 to 1. Broad field
   * classes (a crush zone, a halo) tint the relief instead of flattening it; discrete
   * places (a vent, a core) take the full colour.
   */
  tint: number;
}
/** Presentation by feature rule id, shared by surface classes and place symbols. */
export const magicPlacePresentations: Record<string, MagicPlacePresentation> = {
  core: { color: "#b8352a", symbol: "star", tint: 1 },
  vein: { color: "#c8642f", symbol: "diamond", tint: 1 },
  spring: { color: "#e9a23b", symbol: "circle", tint: 1 },
  vent: { color: "#5a3b2e", symbol: "square", tint: 1 },
  basalt: { color: "#4a4040", symbol: "square", tint: 1 },
  scar: { color: "#302826", symbol: "square", tint: 1 },
  // The halo is the quickened country: the living cover shows through a warm cast.
  halo: { color: "#d9a441", symbol: "circle", tint: 0.3 },
  field: { color: "#3fd9b5", symbol: "circle", tint: 0.8 },
  well: { color: "#a8f0ff", symbol: "star", tint: 1 },
  prism: { color: "#9fd8f0", symbol: "diamond", tint: 1 },
  melt: { color: "#5fb1a3", symbol: "triangle", tint: 1 },
  locus: { color: "#1d2f6b", symbol: "star", tint: 1 },
  crush: { color: "#44506a", symbol: "square", tint: 0.45 },
  // Pale cold water, kept apart from Aurora's saturated teal and the fog coast's grey-green.
  front: { color: "#a9cbdc", symbol: "triangle", tint: 0.55 },
  wake: { color: "#6d7f9c", symbol: "circle", tint: 0.35 },
  lattice: { color: "#5b86c7", symbol: "cross", tint: 0.5 },
  rogue: { color: "#e05a7a", symbol: "triangle", tint: 1 },
  war: { color: "#c23a7e", symbol: "star", tint: 1 },
  steam: { color: "#d9c3e6", symbol: "diamond", tint: 1 },
  breach: { color: "#8f5ce0", symbol: "cross", tint: 1 },
};
const spareColors = ["#d1495b", "#f2a541", "#2e86ab", "#8e44ad", "#1b998b", "#c9a227"];
export function magicPlacePresentation(ruleId: string): MagicPlacePresentation {
  const known = magicPlacePresentations[ruleId];
  if (known) return known;
  let hash = 0;
  for (const char of ruleId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { color: spareColors[hash % spareColors.length], symbol: "circle", tint: 1 };
}

export const magicSurfaceBase = 100;
interface SurfaceRuleSource {
  id: string;
  name: string;
  features: { id: string; name: string }[];
}
/**
 * Final-surface codes above the natural range, one per feature rule in system order.
 * Generation and presentation share this so a code always names the same rule.
 */
export function magicSurfaceCode(
  systems: readonly SurfaceRuleSource[],
  systemId: string,
  ruleId: string
): number | null {
  let code = magicSurfaceBase;
  for (const system of systems)
    for (const rule of system.features) {
      if (system.id === systemId && rule.id === ruleId) return code;
      code++;
    }
  return null;
}
export interface SurfaceCategory {
  code: number;
  name: string;
  color: string;
  /** Natural water surfaces keep the base depth shading instead of a class colour. */
  bathymetric: boolean;
  /** Share of the class colour over the terrain base; see MagicPlacePresentation. */
  tint: number;
  system?: string;
  rule?: string;
}
export function surfaceCategories(systems: readonly SurfaceRuleSource[] = []): SurfaceCategory[] {
  const natural = naturalSurfaceNames.map((name, code) => ({
    code,
    name,
    color: naturalSurfaceColors[name],
    bathymetric: bathymetricSurfaces.has(name),
    tint: 1,
  }));
  const magic: SurfaceCategory[] = [];
  let code = magicSurfaceBase;
  for (const system of systems)
    for (const rule of system.features) {
      const presentation = magicPlacePresentation(rule.id);
      magic.push({
        code: code++,
        name: `${system.name} · ${rule.name}`,
        color: presentation.color,
        bathymetric: false,
        tint: presentation.tint,
        system: system.id,
        rule: rule.id,
      });
    }
  return [...natural, ...magic];
}
export const physicalMaterialNames = [
  "Exposed bedrock",
  "Scree",
  "Permafrost",
  "Tundra soil",
  "Snowpack",
  "Glacial ice",
  "Shelf sediment",
  "Deep marine sediment",
  "Reef stone",
  "Geothermal crust",
  "Moraine till",
  "Basalt",
] as const;

export declare const naturalSurfaceNames: readonly [
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
];
export declare const surfaceCode: (name: (typeof naturalSurfaceNames)[number]) => number;
export type NaturalSurfaceName = (typeof naturalSurfaceNames)[number];
/** Biome-named surfaces share the biome colours; relief and ice surfaces have their own. */
export declare const naturalSurfaceColors: Record<NaturalSurfaceName, string>;
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
export declare const magicPlacePresentations: Record<string, MagicPlacePresentation>;
export declare function magicPlacePresentation(ruleId: string): MagicPlacePresentation;
export declare const magicSurfaceBase = 100;
export interface SurfaceRuleSource {
  id: string;
  name: string;
  features: {
    id: string;
    name: string;
  }[];
}
/** The pseudo-system under which every confluence takes its surface code and place kind. */
export declare const confluenceSourceId = "confluence";
/**
 * Surface code sources in their fixed order: the systems, then the meetings between them as
 * one source. A code names the same class in generation and presentation.
 */
export declare function surfaceRuleSources(
  systems: readonly SurfaceRuleSource[],
  confluences?: readonly {
    id: string;
    name: string;
  }[]
): SurfaceRuleSource[];
/**
 * Final-surface codes above the natural range, one per feature rule in system order.
 * Generation and presentation share this so a code always names the same rule.
 */
export declare function magicSurfaceCode(
  systems: readonly SurfaceRuleSource[],
  systemId: string,
  ruleId: string
): number | null;
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
export declare function surfaceCategories(
  systems?: readonly SurfaceRuleSource[],
  confluences?: readonly {
    id: string;
    name: string;
  }[]
): SurfaceCategory[];
export declare const physicalMaterialNames: readonly [
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
];

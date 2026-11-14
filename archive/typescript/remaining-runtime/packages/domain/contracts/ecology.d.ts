import { z } from "zod";
/** Ecological forcing belongs to the same physical epochs as climate and ice. */
export declare const ecologyEpochSchema: z.ZodObject<
  {
    rainfall: z.ZodDefault<z.ZodNumber>;
    seasonality: z.ZodDefault<z.ZodNumber>;
    productivity: z.ZodDefault<z.ZodNumber>;
    fire: z.ZodDefault<z.ZodNumber>;
    migration: z.ZodDefault<z.ZodNumber>;
    recovery: z.ZodDefault<z.ZodNumber>;
  },
  z.core.$strip
>;
export type EcologyEpoch = z.infer<typeof ecologyEpochSchema>;
export declare const defaultEcologyEpoch: {
  rainfall: number;
  seasonality: number;
  productivity: number;
  fire: number;
  migration: number;
  recovery: number;
};
/** Cover classes are independent of the relief/landform classification. */
export declare const biomes: readonly [
  {
    readonly name: "Unclassified";
    readonly color: "#d1c8ae";
  },
  {
    readonly name: "Ocean";
    readonly color: "#397d99";
  },
  {
    readonly name: "Freshwater";
    readonly color: "#498b99";
  },
  {
    readonly name: "Ice";
    readonly color: "#e2ede8";
  },
  {
    readonly name: "Barren";
    readonly color: "#b5a58c";
  },
  {
    readonly name: "Desert";
    readonly color: "#ddc78d";
  },
  {
    readonly name: "Tundra";
    readonly color: "#a4b19a";
  },
  {
    readonly name: "Grassland";
    readonly color: "#afbd74";
  },
  {
    readonly name: "Savanna";
    readonly color: "#c0b76a";
  },
  {
    readonly name: "Woodland";
    readonly color: "#7eaa66";
  },
  {
    readonly name: "Temperate forest";
    readonly color: "#4f8d55";
  },
  {
    readonly name: "Boreal forest";
    readonly color: "#527c68";
  },
  {
    readonly name: "Rainforest";
    readonly color: "#28674c";
  },
  {
    readonly name: "Marsh";
    readonly color: "#83a794";
  },
  {
    readonly name: "Swamp";
    readonly color: "#547c69";
  },
  {
    readonly name: "Ember grove";
    readonly color: "#6f9f3c";
  },
  {
    readonly name: "Thaw meadow";
    readonly color: "#a9c86f";
  },
  {
    readonly name: "Rime forest";
    readonly color: "#7d98a4";
  },
  {
    readonly name: "Glow-lichen barrens";
    readonly color: "#b9d4d6";
  },
  {
    readonly name: "Fog heath";
    readonly color: "#9db3a1";
  },
  {
    readonly name: "Moss forest";
    readonly color: "#4e8470";
  },
  {
    readonly name: "Deepwood";
    readonly color: "#2f6b3a";
  },
  {
    readonly name: "Wending fen";
    readonly color: "#6e9a7c";
  },
  {
    readonly name: "Well meadow";
    readonly color: "#9cc26a";
  },
  {
    readonly name: "Barrow heath";
    readonly color: "#9a8f7a";
  },
  {
    readonly name: "Salt pan";
    readonly color: "#e8e2d2";
  },
  {
    readonly name: "Glass flat";
    readonly color: "#cfd9e3";
  },
];
export declare const biomeCode: (name: (typeof biomes)[number]["name"]) => number;
/** Named biome regions, by the feature kind of the rule that outlines them. */
export declare const biomeFamilies: readonly [
  {
    readonly kind: "forest";
    readonly name: "Forest";
    readonly color: "#4f8d55";
  },
  {
    readonly kind: "grassland";
    readonly name: "Grassland";
    readonly color: "#afbd74";
  },
  {
    readonly kind: "wetland";
    readonly name: "Wetland";
    readonly color: "#83a794";
  },
  {
    readonly kind: "barren";
    readonly name: "Barren land";
    readonly color: "#ddc78d";
  },
  {
    readonly kind: "ember";
    readonly name: "Ember grove";
    readonly color: "#6f9f3c";
  },
  {
    readonly kind: "thaw";
    readonly name: "Thaw meadow";
    readonly color: "#a9c86f";
  },
  {
    readonly kind: "rime";
    readonly name: "Rime forest";
    readonly color: "#7d98a4";
  },
  {
    readonly kind: "glow";
    readonly name: "Glow-lichen barrens";
    readonly color: "#b9d4d6";
  },
  {
    readonly kind: "fog";
    readonly name: "Fog coast";
    readonly color: "#9db3a1";
  },
  {
    readonly kind: "deepwood";
    readonly name: "Deepwood";
    readonly color: "#2f6b3a";
  },
  {
    readonly kind: "wending";
    readonly name: "Wending fen";
    readonly color: "#6e9a7c";
  },
  {
    readonly kind: "well";
    readonly name: "Well meadow";
    readonly color: "#9cc26a";
  },
  {
    readonly kind: "barrow";
    readonly name: "Barrow heath";
    readonly color: "#9a8f7a";
  },
  {
    readonly kind: "pan";
    readonly name: "Salt pan";
    readonly color: "#e8e2d2";
  },
  {
    readonly kind: "flat";
    readonly name: "Glass flat";
    readonly color: "#cfd9e3";
  },
];
export declare const ecologyLabels: Record<string, string>;

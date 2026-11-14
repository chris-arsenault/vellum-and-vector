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
  // Fallen Fire: the crater, its ejecta fan and the placer gravels below.
  crater: { color: "#7a3b2f", symbol: "star", tint: 1 },
  fan: { color: "#c98f6a", symbol: "triangle", tint: 0.6 },
  placer: { color: "#d8b14a", symbol: "diamond", tint: 1 },
  // Aurora marks the existing ground; its place symbols retain the full class colour.
  field: { color: "#3fd9b5", symbol: "circle", tint: 0.25 },
  well: { color: "#a8f0ff", symbol: "star", tint: 0.6 },
  prism: { color: "#9fd8f0", symbol: "diamond", tint: 0.45 },
  melt: { color: "#5fb1a3", symbol: "triangle", tint: 0.35 },
  locus: { color: "#1d2f6b", symbol: "star", tint: 1 },
  crush: { color: "#44506a", symbol: "square", tint: 0.45 },
  // Pale cold water, kept apart from Aurora's saturated teal and the fog coast's grey-green.
  front: { color: "#a9cbdc", symbol: "triangle", tint: 0.55 },
  wake: { color: "#6d7f9c", symbol: "circle", tint: 0.35 },
  lattice: { color: "#5b86c7", symbol: "cross", tint: 0.5 },
  rogue: { color: "#e05a7a", symbol: "triangle", tint: 1 },
  // A storm track turned aside: pale steel over the country it crosses.
  deviation: { color: "#9cb3d6", symbol: "circle", tint: 0.5 },
  war: { color: "#c23a7e", symbol: "star", tint: 1 },
  steam: { color: "#d9c3e6", symbol: "diamond", tint: 1 },
  breach: { color: "#8f5ce0", symbol: "cross", tint: 1 },
  // Greenwood: deep greens for the stands, bright for the wells; verdant country tints.
  stand: { color: "#2f6b3a", symbol: "square", tint: 1 },
  wellspring: { color: "#7fd36b", symbol: "circle", tint: 1 },
  oasis: { color: "#b7e07a", symbol: "circle", tint: 1 },
  verdant: { color: "#5c9e4f", symbol: "circle", tint: 0.3 },
  sinkhole: { color: "#6e5a3c", symbol: "square", tint: 1 },
  // Greenwood's meetings with Fire, Aurora and Pressure.
  rot: { color: "#8a6a2b", symbol: "diamond", tint: 1 },
  frozen: { color: "#bfe6d9", symbol: "star", tint: 1 },
  brackish: { color: "#7c9a8e", symbol: "triangle", tint: 1 },
  // Salt: the killing ground, the pan and the glass flat take the whole colour; dust tints.
  ground: { color: "#9a8f7a", symbol: "square", tint: 1 },
  pan: { color: "#e8e2d2", symbol: "square", tint: 1 },
  flat: { color: "#cfd9e3", symbol: "diamond", tint: 1 },
  dust: { color: "#d9cfae", symbol: "circle", tint: 0.4 },
  // Hallowed: the ring and the line take a pale gold; a fading ring thins by its coverage.
  ring: { color: "#e9dcae", symbol: "circle", tint: 0.5 },
  line: { color: "#b89b5e", symbol: "cross", tint: 1 },
  // Veil: the tear tints violet, the wild zone takes a brighter violet, the door a pale one.
  tear: { color: "#6f3fa0", symbol: "cross", tint: 0.5 },
  wild: { color: "#b48ad6", symbol: "triangle", tint: 1 },
  door: { color: "#f2d6ff", symbol: "star", tint: 1 },
  // Salt's meetings with Aurora, Fire, Greenwood and Pressure.
  preserved: { color: "#8c9fb3", symbol: "star", tint: 1 },
  fired: { color: "#e36f3a", symbol: "diamond", tint: 1 },
  "standing-dead": { color: "#8c7b4a", symbol: "triangle", tint: 1 },
  "brine-shore": { color: "#c7b7c9", symbol: "circle", tint: 1 },
};
const spareColors = ["#d1495b", "#f2a541", "#2e86ab", "#8e44ad", "#1b998b", "#c9a227"];
export function magicPlacePresentation(ruleId: string): MagicPlacePresentation {
  const known = magicPlacePresentations[ruleId];
  if (known) return known;
  let hash = 0;
  for (const char of ruleId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { color: spareColors[hash % spareColors.length], symbol: "circle", tint: 1 };
}

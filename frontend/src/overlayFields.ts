import { ecologyLabels } from "@atlas/domain";
import type { World } from "./types";

export const overlayThemes = [
  "Climate",
  "Water",
  "Terrain",
  "Biomes and life",
  "People",
  "Magic",
  "Advanced",
];
const common = new Set([
  "temperature",
  "precipitation",
  "moisture",
  "flow",
  "ice",
  "population",
  "treeCover",
  "grassCover",
  "wetlandCover",
  "herbivores",
  "naturalSurface",
  "finalSurface",
]);
export function commonOverlay(channel: string) {
  return common.has(channel) || channel.endsWith(":intensity");
}
export function overlayTheme(channel: string) {
  if (ecologyLabels[channel]) return "Biomes and life";
  if (channel.startsWith("magic:")) return "Magic";
  if (/^(culture|language|religion):|population|settlement/.test(channel)) return "People";
  if (/temperature|rain|snow|moisture|precipitation|wind|runoff/i.test(channel)) return "Climate";
  if (/water|flow|river|ice|sea|ocean|basin|catchment/i.test(channel)) return "Water";
  if (/surface|bedrock|sediment|erosion|landform|fracture|rock|elevation/i.test(channel))
    return "Terrain";
  return "Advanced";
}
/** Group independent fields without converting classified cells into named features. */
export function overlayBranch(world: World, channel: string): string {
  const [kind, id] = channel.split(":");
  if (kind === "magic") return world.magicSystems?.find((system) => system.id === id)?.name ?? id;
  if (kind === "culture") return "Cultural distributions";
  if (kind === "language" || kind === "languageUse") return "Language distributions";
  if (kind === "religion") return "Religious distributions";
  if (/population|settlement/i.test(channel)) return "Population and settlement";
  return "";
}

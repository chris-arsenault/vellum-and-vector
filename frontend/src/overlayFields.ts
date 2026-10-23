import { ecologyLabels } from "@atlas/domain";

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

import { ecologyLabels } from "@atlas/domain";
import type { World } from "./types";
import { fieldName } from "./fieldNames";

export const overlayThemes = [
  "People",
  "Climate",
  "Water",
  "Terrain",
  "Rock and ground",
  "Biomes and life",
  "Magic",
  "Advanced",
];
const common = new Set([
  "Temperature",
  "Rainfall",
  "Moisture",
  "FlowAccumulation",
  "IceThickness",
  "TreeCover",
  "GrassCover",
  "WetlandCover",
  "Herbivores",
  "naturalSurface",
  "finalSurface",
  "SurfaceMaterial",
  "SedimentThickness",
]);
export function commonOverlay(channel: string) {
  return (
    common.has(channel) || channel.endsWith(":intensity") || Boolean(fieldName(channel)?.common)
  );
}
export function overlayTheme(channel: string) {
  const named = fieldName(channel);
  if (named) return named.theme;
  if (ecologyLabels[channel]) return "Biomes and life";
  if (channel.startsWith("magic:")) return "Magic";
  if (/temperature|rain|snow|moisture|precipitation|wind|runoff/i.test(channel)) return "Climate";
  if (/water|flow|river|ice|sea|ocean|basin|catchment/i.test(channel)) return "Water";
  if (/surface|bedrock|sediment|erosion|landform|fracture|rock|elevation/i.test(channel))
    return "Terrain";
  return "Advanced";
}
/** Group independent fields without converting classified cells into named features. */
export function overlayBranch(world: World, channel: string): string {
  const named = fieldName(channel);
  if (named) return named.branch;
  const [kind, id] = channel.split(":");
  if (kind === "magic") return world.magicSystems?.find((system) => system.id === id)?.name ?? id;
  return "";
}

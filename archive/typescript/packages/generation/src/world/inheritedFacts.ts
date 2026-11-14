import {
  areaSpace,
  fieldChannelName,
  spatial,
  requireThat,
  ownsMapGeography,
  type DomainSnapshot,
} from "@atlas/domain";
import { physicalChannels } from "./atlasChannels";
import type { PhysicalBufferName } from "./field";
import { fieldProduct } from "./physicalSteps";

/**
 * What an inherited map brings written: every band its channels carry. A surface with elevation also
 * has the substrate and initially absent sediment supply, geothermal and ice the workspace sets up,
 * even when authored without geological fields. Supplied ice replaces that empty initial band.
 */
export function inheritedProducts(channels: Iterable<string>): string[] {
  const names = new Set(channels),
    bands = new Set<PhysicalBufferName>();
  for (const { name } of physicalChannels) if (names.has(name)) bands.add(name);
  if (names.has("Elevation"))
    for (const band of ["RockKindCodes", "SedimentSupply", "Geothermal", "IceThickness"] as const)
      bands.add(band);
  return [...bands].map(fieldProduct);
}
/**
 * Histories a map with a surface of its own did not inherit, which it holds as nothing having happened:
 * a named history stands for the channels that would have carried it.
 */
export function absentInheritedHistories(channels: Iterable<string>) {
  const names = new Set(channels);
  if (!names.has("Elevation")) return [];
  const carriers: Record<string, string[]> = {
    Fractures: [],
    Impacts: ["ImpactExcavation"],
    VolcanicConstruction: ["VolcanicConstructionHistory"],
    GlacialEvolution: ["CumulativeGlacialErosion", "CumulativeGlacialDeposition"],
    CoastalEvolution: ["CumulativeCoastalErosion"],
  };
  return Object.keys(carriers).filter(
    (history) =>
      carriers[history].length === 0 || !carriers[history].every((name) => names.has(name))
  );
}
export function inheritedChannelNames(source: DomainSnapshot, areaId: string) {
  const area = source.world.areas[areaId],
    space = areaSpace(source.world, areaId);
  const channels = new Set<string>(),
    owned = ownsMapGeography(source.world, areaId),
    fields = source.world.fields.filter(
      (field) => !(field.areaId === areaId && !field.input) && (!owned || field.areaId === areaId)
    );
  for (const field of fields) {
    const grid = source.numerical[field.id];
    if (
      !grid ||
      grid.scope.spaceId !== space ||
      !spatial.covers(grid.scope.footprint, area.footprint)
    )
      continue;
    for (const name of Object.keys(grid.channels).map(fieldChannelName)) {
      const binding = physicalChannels.find((candidate) => candidate.name === name);
      if (binding)
        requireThat(
          grid.units[name] === binding.unit,
          "inherited_units",
          `Inherited ${name} requires ${binding.unit}; received ${grid.units[name]}.`
        );
      channels.add(name);
    }
  }
  return channels;
}

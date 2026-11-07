import {
  areaSpace,
  spatial,
  requireThat,
  ownsMapGeography,
  type DomainSnapshot,
} from "@atlas/domain";
import { atlasChannels } from "./atlasChannels";
import type { PhysicalBufferName } from "./field";
import { fieldProduct } from "./physicalSteps";

/**
 * What an inherited map brings written: every band its channels carry. A surface with elevation also
 * has the material, zero sediment supply and inert geothermal the workspace sets up under it, even when
 * the surface was authored and has no geological fields of its own.
 */
export function inheritedProducts(channels: Iterable<string>): string[] {
  const names = new Set(channels),
    bands = new Set<PhysicalBufferName>();
  for (const { name, native } of atlasChannels) if (names.has(name)) bands.add(native);
  if (names.has("elevation"))
    for (const band of ["RockKindCodes", "SedimentSupply", "Geothermal"] as const) bands.add(band);
  return [...bands].map(fieldProduct);
}
/**
 * Histories a map with a surface of its own did not inherit, which it holds as nothing having happened:
 * a named history stands for the channels that would have carried it.
 */
export function absentInheritedHistories(channels: Iterable<string>) {
  const names = new Set(channels);
  if (!names.has("elevation")) return [];
  const carriers: Record<string, string[]> = {
    Fractures: [],
    Impacts: ["impactExcavation"],
    VolcanicConstruction: ["volcanicConstruction"],
    GlacialEvolution: ["glacialErosion", "glacialDeposition"],
    CoastalEvolution: ["coastalErosion"],
  };
  return Object.keys(carriers).filter(
    (history) =>
      carriers[history].length === 0 || !carriers[history].every((name) => names.has(name))
  );
}
export function inheritedChannelNames(source: DomainSnapshot, areaId: string, physical: boolean) {
  const area = source.world.areas[areaId],
    space = areaSpace(source.world, areaId);
  const channels = new Set<string>(),
    owned = ownsMapGeography(source.world, areaId),
    fields = source.world.fields.filter(
      (field) =>
        !(physical && field.areaId === areaId && !field.input) &&
        (!owned || field.areaId === areaId)
    );
  for (const field of fields) {
    const grid = source.numerical[field.id];
    if (
      !grid ||
      grid.scope.spaceId !== space ||
      !spatial.covers(grid.scope.footprint, area.footprint)
    )
      continue;
    for (const name of Object.keys(grid.channels)) {
      const binding = atlasChannels.find((candidate) => candidate.name === name);
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

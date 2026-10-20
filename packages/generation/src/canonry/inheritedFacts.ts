import { areaSpace, spatial, requireThat, type DomainSnapshot } from "@atlas/domain";
import { atlasChannels } from "./atlasChannels";

/** Histories are inherited only when their numerical channels were supplied. */
export function inheritedNativeFacts(channels: Iterable<string>): string[] {
  const names = new Set(channels);
  // The workspace establishes material, zero sediment supply and inert geothermal
  // inputs when an authored surface has no corresponding geological fields.
  const facts = names.has("elevation")
    ? ["Elevation", "LandscapeHistory", "SedimentSupply", "Geothermal"]
    : [];
  const bindings: Record<string, string[]> = {
    TectonicProvinces: ["province"],
    ContinentalDomains: ["continentalFraction"],
    FractureState: ["fracture"],
    Impacts: ["impactExcavation"],
    VolcanicConstruction: ["volcanicConstruction"],
    GlacialEvolution: ["glacialErosion", "glacialDeposition"],
    CoastalEvolution: ["coastalErosion"],
    SedimentTransport: ["deposition"],
  };
  for (const [fact, required] of Object.entries(bindings))
    if (required.every((name) => names.has(name))) facts.push(fact);
  return facts;
}
export function absentInheritedHistories(channels: Iterable<string>) {
  const facts = new Set(inheritedNativeFacts(channels));
  return [
    "Fractures",
    "Impacts",
    "VolcanicConstruction",
    "GlacialEvolution",
    "CoastalEvolution",
    "SedimentTransport",
  ].filter((fact) => !facts.has(fact));
}
export function inheritedChannelNames(source: DomainSnapshot, areaId: string, physical: boolean) {
  const area = source.world.areas[areaId],
    space = areaSpace(source.world, areaId);
  const channels = new Set<string>();
  for (const field of source.world.fields) {
    if (physical && field.areaId === areaId) continue;
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

import { areaSpace, point, spatial, type DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";

export function coastalMagicDiagnostics(source: DomainSnapshot, input: AtlasGenerationInput) {
  const selection = input.resolvedFeatures!.selection;
  if (!input.domains.includes("physical") || selection["physical.coastal-evolution"].enabled)
    return [];
  const owners: string[] = [];
  if (
    selection["magic.configured"].enabled &&
    input.settings!.magicSystems.some(
      (system) => system.enabled && system.effects.coastalForcing !== 0
    )
  )
    owners.push("magic.configured");
  if (selection["magic.local"].enabled && hasLocalPressure(source, input))
    owners.push("magic.local");
  return owners.map((owner) => ({
    severity: "error" as const,
    code: "feature_dependency",
    invocation: owner,
    resource: "physical.coastal-evolution",
    message:
      "Magical coastal modification requires physical.coastal-evolution. Enable it or remove the coastal forcing.",
  }));
}
function hasLocalPressure(source: DomainSnapshot, input: AtlasGenerationInput) {
  const area = source.world.areas[input.areaId],
    spaceId = areaSpace(source.world, area.id);
  return source.world.magic.some((magic) => {
    if (
      magic.systemId ||
      magic.effect !== "pressure" ||
      magic.strength === 0 ||
      magic.startsAtEpoch >= input.settings!.epochs.length ||
      (magic.spaceId && magic.spaceId !== spaceId)
    )
      return false;
    const target = magic.scope ? spatial.intersection(magic.scope, area.footprint) : area.footprint;
    return target !== null && spatial.distance(point(magic.source), target) < magic.radius;
  });
}

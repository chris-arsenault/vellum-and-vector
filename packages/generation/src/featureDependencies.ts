import {
  areaSpace,
  ecologyLabels,
  locatedMagicEffectDefinitions,
  point,
  spatial,
  type Diagnostic,
  type DomainSnapshot,
  type MagicSystem,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { FeatureRequirement } from "./features";
import { effectiveMagicRules } from "./canonry/magicFeatures";
import { ecologicalMagicEffects } from "./canonry/ecologyProcesses";
function requirement(
  feature: string,
  path: (string | number)[],
  message: string
): FeatureRequirement {
  return { feature, field: { feature: "magic.configured", path }, message };
}

/** Use the same effective rules as classification, including independent disabled containers. */
export function configuredMagicRequirements(
  systems: MagicSystem[],
  physical = true
): FeatureRequirement[] {
  return systems.flatMap((system, index) => [
    ...effectRequirements(system, index, physical),
    ...ruleRequirements(system, index),
  ]);
}
function effectRequirements(
  system: MagicSystem,
  index: number,
  physical: boolean
): FeatureRequirement[] {
  if (!system.enabled) return [];
  const path = ["magicSystems", index, "effects"];
  const requirements = ecologicalMagicEffects
    .filter((effect) => system.effects[effect] !== 0)
    .map((effect) =>
      requirement(
        "ecology.living",
        [...path, effect],
        `${system.name}'s ${effect} effect requires Living ecology. Enable it or remove that effect.`
      )
    );
  if (physical && system.effects.coastalForcing !== 0)
    requirements.push(
      requirement(
        "physical.coastal-evolution",
        [...path, "coastalForcing"],
        "Magical coastal modification requires physical.coastal-evolution. Enable it or remove the coastal forcing."
      )
    );
  return requirements;
}
function ruleRequirements(system: MagicSystem, index: number): FeatureRequirement[] {
  const effective = new Set(effectiveMagicRules(system));
  return system.features.flatMap((rule, ruleIndex) => {
    if (!effective.has(rule)) return [];
    return (["seeds", "retains"] as const).flatMap((kind) =>
      (rule[kind] ?? []).flatMap((group, groupIndex) =>
        group.flatMap((condition, conditionIndex) =>
          Object.hasOwn(ecologyLabels, condition.field)
            ? [
                requirement(
                  "ecology.living",
                  [
                    "magicSystems",
                    index,
                    "features",
                    ruleIndex,
                    kind,
                    groupIndex,
                    conditionIndex,
                    "field",
                  ],
                  `${rule.name} reads ecological geography. Enable Living ecology or remove that condition.`
                ),
              ]
            : []
        )
      )
    );
  });
}

export function activeLocatedSources(source: DomainSnapshot, input: AtlasGenerationInput) {
  const area = source.world.areas[input.areaId],
    spaceId = areaSpace(source.world, area.id);
  return source.world.magic.filter((magic) => {
    if (
      magic.systemId ||
      magic.strength === 0 ||
      magic.startsAtEpoch >= input.settings!.epochs.length ||
      (magic.spaceId && magic.spaceId !== spaceId)
    )
      return false;
    const target = magic.scope ? spatial.intersection(magic.scope, area.footprint) : area.footprint;
    return target !== null && spatial.distance(point(magic.source), target) < magic.radius;
  });
}
export { landmarksInExtent } from "./landmarkSelection";
export function locatedMagicRequirements(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): FeatureRequirement[] {
  if (
    !input.domains.includes("physical") ||
    !activeLocatedSources(source, input).some((magic) => magic.effect === "pressure")
  )
    return [];
  return [
    {
      feature: "physical.coastal-evolution",
      message:
        "Magical coastal modification requires physical.coastal-evolution. Enable it or remove the coastal forcing.",
    },
  ];
}
export function locatedMagicWarnings(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): Diagnostic[] {
  return activeLocatedSources(source, input).flatMap((magic) => {
    const definition =
      locatedMagicEffectDefinitions[magic.effect as keyof typeof locatedMagicEffectDefinitions];
    return definition && !definition.physicalFeedback
      ? [
          {
            severity: "warning" as const,
            code: "magic_intensity_only",
            invocation: "magic.local",
            resource: magic.id,
            message: `${magic.name}: ${magic.effect} publishes an influence intensity field only; physical ${magic.effect} feedback is not simulated.`,
          },
        ]
      : [];
  });
}

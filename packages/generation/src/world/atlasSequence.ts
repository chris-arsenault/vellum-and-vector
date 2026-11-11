import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { ProcessInvocation, ProcessSequence } from "../process";
import { resolveGenerationFeatures, type FeatureContributionContext } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { composeFeatureSlot } from "../physicalFeatureSequence";
import { atlasGenerationModules } from "../generationModules";
import { worldGenerationSettings, type GenerationSettings } from "../generationSettings";
import { hasHumanRound } from "../societyRound";

type Composition = FeatureContributionContext;

function invoke(id: string, parameters: ProcessInvocation["parameters"] = {}): ProcessInvocation {
  return { kind: "process", id, process: id, version: "1", parameters };
}
function contributions(slot: string, context: Composition): ProcessSequence {
  return atlasGenerationModules.contribute(slot, context.resolved, context);
}
function nativeGroup(
  slot: string,
  occurrence: string,
  context: Composition,
  options: { initial?: boolean; material?: boolean } = {}
): ProcessSequence {
  return composeFeatureSlot(
    slot,
    `${occurrence}/${slot}`,
    { ...context, ...options },
    {
      initial: options.initial ?? false,
    }
  );
}
function named(sequence: ProcessSequence, occurrence: string): ProcessSequence {
  return sequence.map((step) => ({ ...step, id: `${occurrence}/${step.id}` }));
}
function climate(occurrence: string, context: Composition, material = false): ProcessSequence {
  const result: ProcessSequence = [];
  for (const slot of ["climate.ocean", "climate.circulation", "climate.atmosphere"])
    result.push(...nativeGroup(slot, occurrence, context, { material }));
  return result;
}
function drainage(occurrence: string, context: Composition): ProcessSequence {
  return [
    ...nativeGroup("water.runoff", occurrence, context),
    ...nativeGroup("water.routing", occurrence, context),
  ];
}
function materialGeology(occurrence: string, context: Composition, initial: boolean) {
  return [
    "material.relaxation",
    "material.hillslopes",
    "material.support.before-margins",
    "material.ocean.before-margins",
    "material.margins",
    "material.support.after-margins",
    "material.ocean.after-margins",
  ].flatMap((slot) => nativeGroup(slot, occurrence, context, { initial }));
}
function geology(context: Composition, initial: boolean): ProcessSequence {
  const occurrence = initial ? "formation" : "epoch.geology";
  const slots = initial
    ? ["formation.foundation", "formation.mountains", "formation.volcanism", "formation.impacts"]
    : [
        "epoch.advection",
        "epoch.crust.provinces",
        "epoch.crust.activity",
        "epoch.crust.structure",
        ...(context.resolved.selection["physical.tectonic-history"]?.enabled
          ? []
          : ["epoch.mountains"]),
        "epoch.volcanism",
        "epoch.impacts",
        "epoch.landmarks",
      ];
  return [
    ...slots.flatMap((slot) => nativeGroup(slot, occurrence, context, { initial })),
    ...materialGeology(occurrence, context, initial),
    ...(initial
      ? ["formation.coastal-construction", "formation.ocean.final"].flatMap((slot) =>
          nativeGroup(slot, occurrence, context, { initial })
        )
      : []),
    ...["geology.fractures", "geology.geothermal"].flatMap((slot) =>
      nativeGroup(slot, occurrence, context, { initial })
    ),
  ];
}
function humanRound(context: Composition): ProcessSequence {
  const settings = context.input.settings;
  const society = ["human.cultures", "human.politics", "built.layout"].some(
    (id) => context.resolved.selection[id]?.enabled
  );
  if (!settings || !society || !hasHumanRound(settings as GenerationSettings)) return [];
  return [
    { kind: "process", id: "human.round", process: "human.round", version: "1", parameters: {} },
  ];
}
function epochBody(context: Composition, inherited: boolean): ProcessSequence {
  return [
    invoke("atlas.begin-epoch"),
    ...(!inherited ? geology(context, false) : []),
    ...climate("epoch.initial-climate", context, true),
    ...contributions("epoch.climate-forcing", context),
    ...contributions("epoch.material-forcing", context),
    ...drainage("epoch.initial-water", context),
    ...contributions("epoch.ecology-evolve", context),
    ...drainage("epoch.after-ecology-water", context),
    ...nativeGroup("epoch.incision", "epoch", context),
    ...nativeGroup("epoch.after-incision.hillslopes", "epoch", context),
    ...climate("epoch.after-incision-climate", context),
    ...drainage("epoch.after-incision-water", context),
    ...nativeGroup("epoch.sediment", "epoch", context),
    ...nativeGroup("ice.model", "epoch.glaciation", context),
    // Accumulation changes actual water storage and loading before that ice sculpts its bed.
    ...nativeGroup("epoch.ice-load", "epoch.after-ice-balance", context),
    ...nativeGroup("climate.ocean", "epoch.after-ice-balance", context),
    ...nativeGroup("ice.flow", "epoch.after-ice-balance", context),
    ...nativeGroup("epoch.sculpting", "epoch", context),
    ...nativeGroup("epoch.ice-load", "epoch", context),
    ...climate("epoch.after-glaciation-climate", context),
    ...drainage("epoch.after-glaciation-water", context),
    ...nativeGroup("ice.flow", "epoch.post-glacial", context),
    ...nativeGroup("ice.meltwater", "epoch.post-glacial", context),
    ...drainage("epoch.meltwater", context),
    ...nativeGroup("water.groundwater", "epoch", context),
    ...contributions("epoch.post-glacial-forcing", context),
    ...contributions("epoch.ecology-respond", context),
    ...drainage("epoch.after-response-water", context),
    // One human round inside an epoch with a bound era: people settle, use and exploit
    // before the coasts are cut and the epoch's history is kept.
    ...humanRound(context),
    ...contributions("epoch.coastal-forcing", context),
    ...nativeGroup("epoch.coasts", "epoch", context),
    ...contributions("epoch.ecology-burial", context),
    ...contributions("epoch.influence-history", context),
    ...contributions("epoch.storage", context),
    // What each place does to the field, once the epoch's processes have made its places.
    {
      kind: "process",
      id: "poi.effects",
      process: "poi.effects",
      version: "1",
      parameters: {},
    },
    // Landmarks hold their signatures at the World mesh before the epoch's history is kept.
    ...(!inherited ? contributions("epoch.landmark-maintenance", context) : []),
    ...nativeGroup("epoch.history", "epoch", context),
  ];
}
export function atlasPhysicalSequence(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): ProcessSequence {
  const inherited = inheritsPhysical(source, input);
  const context = composition(source, input);
  const result: ProcessSequence = [
    invoke("atlas.initialize"),
    {
      kind: "process",
      id: "atlas.absent-physical",
      process: "atlas.absent-physical",
      version: "1",
    },
    ...contributions("initialize.influences", context),
  ];
  // A child inherits its parent's geology and realizes the relief below the parent's cells.
  if (!inherited) result.push(...geology(context, true));
  else result.push(...named(contributions("terrain.refinement", context), "refinement"));
  result.push(...contributions("initialize.ecology", context));
  result.push({
    kind: "epochs",
    id: "physical-history",
    resetFacts: [],
    epochs: source.world.epochs.map((epoch) => ({
      id: epoch.id,
      duration: epoch.duration ?? 1000,
      parentEpoch: epoch.id,
      variables: {
        temperature: epoch.temperature,
        seaLevel: epoch.seaLevel,
        activity: epoch.tectonics,
      },
    })),
    body: epochBody(context, inherited),
  });
  result.push(
    ...climate("present.climate", context),
    ...contributions("present.climate-forcing", context),
    ...drainage("present.initial-water", context),
    ...nativeGroup("ice.flow", "present.initial-ice", context),
    ...nativeGroup("ice.meltwater", "present", context),
    ...drainage("present.meltwater", context),
    ...nativeGroup("ice.flow", "present.final-ice", context),
    ...presentExtraction(context),
    ...contributions("present.post-glacial-forcing", context),
    ...contributions("present.ecology", context),
    ...contributions("present.classify", context),
    invoke("atlas.project"),
    ...contributions("present.project", context),
    invoke("atlas.features")
  );
  return result;
}
/** A child inherits its parent's geology; a root map makes its own. */
function inheritsPhysical(source: DomainSnapshot, input: AtlasGenerationInput) {
  return Boolean(source.world.areas[input.areaId].parentId && source.world.fields.length);
}
function presentExtraction(context: Composition): ProcessSequence {
  return [
    "present.glacial-landforms",
    "present.sea-ice",
    "present.landforms",
    "present.river-geometry",
    "present.floodplains",
    "present.deltas",
    "present.validation",
  ].flatMap((slot) => nativeGroup(slot, "present", context));
}
function composition(source: DomainSnapshot, input: AtlasGenerationInput): Composition {
  const features =
    input.resolvedFeatures ??
    resolveGenerationFeatures(
      physicalFeatureDefinitions,
      input.features,
      input.parameters,
      input.domains,
      (input.settings ??
        worldGenerationSettings(source.world)) as unknown as import("@atlas/domain").ParameterValues
    );
  return {
    source,
    input,
    resolved: features,
  };
}

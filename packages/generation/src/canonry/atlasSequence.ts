import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { ProcessInvocation, ProcessSequence } from "../process";
import { resolveGenerationFeatures, type FeatureContributionContext } from "../features";
import { physicalFeatureDefinitions, physicalFeatureSequence } from "../physicalFeatures";
import { nativeContracts } from "./contracts";
import { atlasGenerationModules } from "../generationModules";
import { worldGenerationSettings } from "../generationSettings";

type Composition = FeatureContributionContext;

function invoke(id: string, parameters: ProcessInvocation["parameters"] = {}): ProcessInvocation {
  return { kind: "process", id, process: id, version: "0f62584c", parameters };
}
function contributions(slot: string, context: Composition): ProcessSequence {
  return atlasGenerationModules.contribute(slot, context.resolved, context);
}
function nativeGroup(
  slot: string,
  occurrence: string,
  context: Composition,
  options: { initial?: boolean; iceLoad?: boolean; material?: boolean } = {}
): ProcessSequence {
  const body: ProcessSequence = [];
  const bound = { ...context, ...options };
  for (const step of physicalFeatureSequence(slot, context.resolved, bound)) {
    if (step.kind !== "process") throw new Error("A physical contribution must name model passes.");
    const name = step.process.slice("canonry.".length);
    if (!isNativePass(step, name)) {
      body.push(step);
      continue;
    }
    const hooks = { ...bound, process: step.process };
    body.push(...contributions("before.model-pass", hooks));
    body.push({
      ...step,
      parameters: {
        initial: options.initial ?? false,
        iceLoad: options.iceLoad ?? false,
        ...step.parameters,
      },
    });
    body.push(...contributions("after.model-pass", hooks));
  }
  return named(body, `${occurrence}/${slot}`);
}
function isNativePass(step: ProcessInvocation, name: string) {
  return (
    step.process.startsWith("canonry.") &&
    Object.hasOwn(nativeContracts, name) &&
    step.version === "0f62584c"
  );
}
function named(sequence: ProcessSequence, occurrence: string): ProcessSequence {
  return sequence.map((step) => ({ ...step, id: `${occurrence}/${step.id}` }));
}
function climate(occurrence: string, context: Composition, material = false): ProcessSequence {
  const result = named(contributions("climate.refinement", context), occurrence);
  for (const slot of ["climate.ocean", "climate.circulation", "climate.atmosphere"])
    result.push(...nativeGroup(slot, occurrence, context, { material }));
  return result;
}
function drainage(occurrence: string, context: Composition, meltwater = false): ProcessSequence {
  return [
    ...nativeGroup("water.runoff", occurrence, context),
    ...(meltwater ? nativeGroup("water.glacial-runoff", occurrence, context) : []),
    ...nativeGroup("water.routing", occurrence, context),
  ];
}
function materialGeology(occurrence: string, context: Composition, initial: boolean) {
  return [
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
        "epoch.mountains",
        "epoch.volcanism",
        "epoch.impacts",
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
function epochBody(context: Composition, inherited: boolean): ProcessSequence {
  return [
    invoke("canonry.begin-epoch"),
    ...(!inherited ? geology(context, false) : []),
    ...climate("epoch.initial-climate", context, true),
    ...contributions("epoch.climate-forcing", context),
    ...contributions("epoch.material-forcing", context),
    ...drainage("epoch.initial-water", context),
    ...contributions("water.refinement", context),
    ...contributions("epoch.ecology-evolve", context),
    ...drainage("epoch.after-ecology-water", context),
    ...nativeGroup("epoch.incision", "epoch", context),
    ...nativeGroup("epoch.after-incision.hillslopes", "epoch", context),
    ...climate("epoch.after-incision-climate", context),
    ...drainage("epoch.after-incision-water", context),
    ...nativeGroup("epoch.sediment", "epoch", context),
    ...nativeGroup("ice.model", "epoch.glaciation", context, { iceLoad: true }),
    ...nativeGroup("epoch.sculpting", "epoch", context),
    ...nativeGroup("epoch.ice-load", "epoch", context),
    ...climate("epoch.after-glaciation-climate", context),
    ...drainage("epoch.after-glaciation-water", context),
    ...nativeGroup("ice.model", "epoch.post-glacial", context),
    ...nativeGroup("ice.meltwater", "epoch.post-glacial", context),
    ...drainage("epoch.meltwater", context, true),
    ...contributions("epoch.post-glacial-forcing", context),
    ...contributions("epoch.influence-history", context),
    ...contributions("epoch.ecology-respond", context),
    ...drainage("epoch.after-response-water", context, true),
    ...contributions("epoch.coastal-forcing", context),
    ...nativeGroup("epoch.coasts", "epoch", context),
    ...contributions("epoch.ecology-burial", context),
    ...contributions("epoch.storage", context),
    ...nativeGroup("epoch.history", "epoch", context),
  ];
}
export function atlasPhysicalSequence(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): ProcessSequence {
  const physical = input.domains.includes("physical");
  const area = source.world.areas[input.areaId],
    inherited = !physical || Boolean(area.parentId && source.world.fields.length);
  const context = composition(source, input);
  const result: ProcessSequence = [
    invoke("canonry.initialize"),
    {
      kind: "process",
      id: "atlas.absent-physical",
      process: "atlas.absent-physical",
      version: "1",
    },
    ...contributions("initialize.influences", context),
  ];
  if (!inherited) result.push(...geology(context, true));
  result.push(...contributions("initialize.ecology", context));
  if (physical)
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
    ...climate("present.climate", context, !physical),
    ...contributions("present.climate-forcing", context),
    ...(!physical ? contributions("present.material-forcing", context) : []),
    ...drainage("present.initial-water", context),
    ...nativeGroup("ice.model", "present.initial-ice", context),
    ...nativeGroup("ice.meltwater", "present", context),
    ...drainage("present.meltwater", context, true),
    ...nativeGroup("ice.model", "present.final-ice", context),
    ...presentExtraction(context),
    ...contributions("present.post-glacial-forcing", context),
    ...(!physical ? contributions("present.influence-history", context) : []),
    ...contributions("present.ecology", context),
    ...contributions("present.classify", context),
    invoke("canonry.project"),
    ...contributions("present.project", context)
  );
  if (physical || input.domains.includes("magic")) result.push(invoke("canonry.features"));
  return result;
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
      input.processes,
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

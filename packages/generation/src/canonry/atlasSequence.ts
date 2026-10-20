import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { MapProcess, ProcessInvocation, ProcessSequence } from "../process";
import { thermalMagicProcess, magicStorageProcess } from "../mapMagic";
import { materialMagicProcess } from "../mapMagicEffects";
import { advectAtlasMagic } from "./atlasMagic";
import { resolveGenerationFeatures, type ResolvedFeatures } from "../features";
import { physicalFeatureDefinitions, physicalFeatureSequence } from "../physicalFeatures";
import { nativeContracts } from "./contracts";

interface Composition {
  features: ResolvedFeatures;
  localMagic: boolean;
  configuredMagic: boolean;
  ecology: boolean;
  refinement: boolean;
}

function invoke(id: string, parameters: ProcessInvocation["parameters"] = {}): ProcessInvocation {
  return { kind: "process", id, process: id, version: "0f62584c", parameters };
}
function legacy(process: MapProcess): ProcessInvocation {
  return {
    kind: "process",
    id: process.contract.id,
    process: process.contract.id,
    version: process.contract.version,
  };
}
function ecology(name: string): ProcessInvocation {
  return { kind: "process", id: `ecology-${name}`, process: `atlas.ecology-${name}`, version: "1" };
}
function temperatureForcing(material: boolean): ProcessSequence {
  return [
    invoke("canonry.temperature", { unforced: true }),
    invoke("canonry.project", { forcingOnly: true }),
    legacy(thermalMagicProcess),
    ...(material ? [legacy(materialMagicProcess)] : []),
    invoke("canonry.forcing"),
  ];
}
function afterNativeStep(name: string, context: Composition, iceLoad: boolean): ProcessSequence {
  const result: ProcessSequence = [];
  if (context.refinement && iceLoad && name === "ice-flow")
    result.push(invoke("canonry.refine-ice"));
  if (context.localMagic && name === "plate-advection") result.push(legacy(advectAtlasMagic));
  return result;
}
function nativeGroup(
  slot: string,
  occurrence: string,
  context: Composition,
  options: { initial?: boolean; iceLoad?: boolean; material?: boolean } = {}
): ProcessSequence {
  const body: ProcessSequence = [];
  for (const step of physicalFeatureSequence(slot, context.features)) {
    if (step.kind !== "process") throw new Error("A physical contribution must name model passes.");
    const name = step.process.slice("canonry.".length);
    if (!isNativePass(step, name)) {
      body.push(step);
      continue;
    }
    if (context.localMagic && name === "temperature")
      body.push(...named(temperatureForcing(Boolean(options.material)), "local-forcing"));
    body.push({
      ...step,
      parameters: {
        initial: options.initial ?? false,
        iceLoad: options.iceLoad ?? false,
        ...step.parameters,
      },
    });
    body.push(...afterNativeStep(name, context, Boolean(options.iceLoad)));
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
  const result =
    context.refinement && context.features.selection["physical.climate"].enabled
      ? named([invoke("canonry.refine-climate")], occurrence)
      : [];
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
        ...(context.features.selection["physical.tectonic-history"].enabled
          ? [
              "epoch.advection",
              "epoch.crust.provinces",
              "epoch.crust.activity",
              "epoch.crust.structure",
            ]
          : []),
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
function magicStage(name: string, context: Composition): ProcessSequence {
  return context.configuredMagic ? [invoke(`canonry.magic-${name}`)] : [];
}
function ecologyStage(name: string, context: Composition): ProcessSequence {
  return context.ecology ? [ecology(name)] : [];
}
function epochBody(context: Composition, inherited: boolean): ProcessSequence {
  return [
    invoke("canonry.begin-epoch"),
    ...(!inherited ? geology(context, false) : []),
    ...climate("epoch.initial-climate", context, true),
    ...magicStage("climate", context),
    ...magicStage("rocks", context),
    ...drainage("epoch.initial-water", context),
    ...(context.refinement ? [invoke("canonry.refine-water")] : []),
    ...ecologyStage("evolve", context),
    ...drainage("epoch.after-ecology-water", context),
    ...nativeGroup("epoch.incision", "epoch", context),
    ...(context.features.selection["physical.river-incision"].enabled
      ? nativeGroup("epoch.after-incision.hillslopes", "epoch", context)
      : []),
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
    ...magicStage("post-glacial", context),
    ...magicStage("history", context),
    ...ecologyStage("respond", context),
    ...drainage("epoch.after-response-water", context, true),
    ...magicStage("coast", context),
    ...nativeGroup("epoch.coasts", "epoch", context),
    ...ecologyStage("burial", context),
    ...(context.localMagic ? [legacy(magicStorageProcess)] : []),
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
    invoke("canonry.magic-initialize"),
  ];
  if (!inherited) result.push(...geology(context, true));
  result.push(...ecologyStage("initialize", context));
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
    ...magicStage("climate", context),
    ...(!physical ? magicStage("rocks", context) : []),
    ...drainage("present.initial-water", context),
    ...nativeGroup("ice.model", "present.initial-ice", context),
    ...nativeGroup("ice.meltwater", "present", context),
    ...drainage("present.meltwater", context, true),
    ...nativeGroup("ice.model", "present.final-ice", context),
    ...presentExtraction(context),
    ...magicStage("post-glacial", context),
    ...(!physical ? magicStage("history", context) : []),
    ...ecologyStage("present", context),
    ...magicStage("classify", context),
    invoke("canonry.project"),
    ...magicStage("project", context)
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
      input.domains
    );
  const enabled = (id: string) =>
    features.selection[id]?.enabled ?? input.domains.includes("magic");
  return {
    features,
    localMagic: enabled("magic.local") && source.world.magic.some((source) => !source.systemId),
    configuredMagic: enabled("magic.configured"),
    ecology: features.selection["ecology.living"]?.enabled ?? true,
    refinement: source.world.areas[input.areaId].profile !== "world",
  };
}

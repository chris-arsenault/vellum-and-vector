import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { MapProcess, ProcessInvocation, ProcessSequence } from "../process";
import { thermalMagicProcess, magicStorageProcess } from "../mapMagic";
import { materialMagicProcess } from "../mapMagicEffects";
import { advectAtlasMagic } from "./atlasMagic";
import {
  climateSteps,
  coastalSteps,
  drainageSteps,
  extractionSteps,
  geologySteps,
  glaciationSteps,
  glacialRunoffStep,
  historyStep,
  iceSteps,
  incisionSteps,
  initialSteps,
  meltwaterStep,
  sedimentStep,
  validationStep,
  type NativeStep,
} from "./sequence";

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
function afterNativeStep(name: string, magic: boolean, iceLoad: boolean): ProcessSequence {
  const result: ProcessSequence = [];
  if (iceLoad && name === "ice-flow") result.push(invoke("canonry.refine-ice"));
  if (magic && name === "plate-advection") result.push(legacy(advectAtlasMagic));
  return result;
}
function nativeSteps(
  steps: readonly NativeStep[],
  magic: boolean,
  initial = false,
  iceLoad = false,
  material = false
): ProcessSequence {
  const body: ProcessSequence = [];
  if (steps === climateSteps) body.push(invoke("canonry.refine-climate"));
  for (const [index, [name]] of steps.entries()) {
    if (magic && name === "temperature") body.push(...temperatureForcing(material));
    body.push({ ...invoke(`canonry.${name}`, { initial, iceLoad }), id: `${name}:${index}` });
    body.push(...afterNativeStep(name, magic, iceLoad));
  }
  return body;
}
function drainage(magic: boolean, meltwater = false): ProcessSequence {
  return nativeSteps(
    meltwater ? [drainageSteps[0], glacialRunoffStep, ...drainageSteps.slice(1)] : drainageSteps,
    magic
  );
}
function epochBody(magic: boolean, inherited: boolean): ProcessSequence {
  const body: ProcessSequence = [
    invoke("canonry.begin-epoch"),
    ...nativeSteps(inherited ? [] : geologySteps, magic),
    ...nativeSteps(climateSteps, magic, false, false, true),
    invoke("canonry.magic-climate"),
    invoke("canonry.magic-rocks"),
    ...drainage(magic),
    invoke("canonry.refine-water"),
    ecology("evolve"),
    ...drainage(magic),
    ...nativeSteps(incisionSteps, magic),
    ...nativeSteps(climateSteps, magic),
    ...drainage(magic),
    ...nativeSteps([sedimentStep], magic),
    ...nativeSteps(glaciationSteps, magic, false, true),
    ...nativeSteps(climateSteps, magic),
    ...drainage(magic),
    ...nativeSteps([...iceSteps, meltwaterStep], magic),
    ...drainage(magic, true),
    invoke("canonry.magic-post-glacial"),
    invoke("canonry.magic-history"),
    ecology("respond"),
    ...drainage(magic, true),
    invoke("canonry.magic-coast"),
    ...nativeSteps(coastalSteps, magic),
    ecology("burial"),
    ...(magic ? [legacy(magicStorageProcess)] : []),
    ...nativeSteps([historyStep], magic),
  ];
  return body.map((step, index) => ({ ...step, id: `${step.id}:${index}` }));
}
export function atlasPhysicalSequence(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): ProcessSequence {
  const physical = input.domains.includes("physical"),
    magic = source.world.magic.some((source) => !source.systemId);
  const area = source.world.areas[input.areaId],
    inherited = !physical || Boolean(area.parentId && source.world.fields.length);
  const result: ProcessSequence = [
    invoke("canonry.initialize"),
    invoke("canonry.magic-initialize"),
  ];
  if (!inherited) result.push(...nativeSteps(initialSteps, magic, true));
  result.push(ecology("initialize"));
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
      body: epochBody(magic, inherited),
    });
  result.push(
    ...nativeSteps(climateSteps, magic, false, false, !physical),
    invoke("canonry.magic-climate"),
    ...(!physical ? [invoke("canonry.magic-rocks")] : []),
    ...drainage(magic),
    ...nativeSteps([...iceSteps, meltwaterStep], magic),
    ...drainage(magic, true),
    ...nativeSteps([...iceSteps, ...extractionSteps, validationStep], magic),
    invoke("canonry.magic-post-glacial"),
    ...(!physical ? [invoke("canonry.magic-history")] : []),
    ecology("present"),
    invoke("canonry.magic-classify"),
    ...finishingSteps(physical, area.profile),
    invoke("canonry.project"),
    invoke("canonry.magic-project")
  );
  if (physical || input.domains.includes("magic")) result.push(invoke("canonry.features"));
  const selected = area.profile === "world" ? fixedSamplingSequence(result) : result;
  return selected.map((step, index) => ({ ...step, id: `${step.id}:${index}` }));
}
function finishingSteps(physical: boolean, profile: string): ProcessSequence {
  return physical && profile === "world" ? [invoke("canonry.landscape-finalize")] : [];
}
function fixedSamplingSequence(sequence: ProcessSequence): ProcessSequence {
  const refinements = ["canonry.refine-climate", "canonry.refine-water", "canonry.refine-ice"];
  return sequence
    .filter((step) => step.kind !== "process" || !refinements.includes(step.process))
    .map((step) =>
      step.kind === "epochs" ? { ...step, body: fixedSamplingSequence(step.body) } : step
    );
}

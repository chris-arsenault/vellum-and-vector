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
function nativeSteps(
  steps: readonly NativeStep[],
  magic: boolean,
  initial = false,
  iceLoad = false,
  material = false
): ProcessSequence {
  const body: ProcessSequence = [];
  for (const [index, [name]] of steps.entries()) {
    if (magic && name === "temperature")
      body.push(
        invoke("canonry.temperature", { unforced: true }),
        invoke("canonry.project", { forcingOnly: true }),
        legacy(thermalMagicProcess),
        ...(material ? [legacy(materialMagicProcess)] : []),
        invoke("canonry.forcing")
      );
    body.push({ ...invoke(`canonry.${name}`, { initial, iceLoad }), id: `${name}:${index}` });
    if (magic && name === "plate-advection") body.push(legacy(advectAtlasMagic));
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
    ...nativeSteps(coastalSteps, magic),
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
    magic = input.domains.includes("magic") || source.world.magic.length > 0;
  const area = source.world.areas[input.areaId],
    inherited = !physical || Boolean(area.parentId && source.world.fields.length);
  const result: ProcessSequence = [invoke("canonry.initialize")];
  if (!inherited) result.push(...nativeSteps(initialSteps, magic, true));
  if (physical)
    result.push({
      kind: "epochs",
      id: "physical-history",
      resetFacts: [],
      epochs: source.world.epochs.map((epoch) => ({
        id: epoch.id,
        duration: 1000,
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
    ...drainage(magic),
    ...nativeSteps([...iceSteps, meltwaterStep], magic),
    ...drainage(magic, true),
    ...nativeSteps([...iceSteps, ...extractionSteps, validationStep], magic),
    invoke("canonry.project")
  );
  if (physical) result.push(invoke("canonry.features"));
  return result.map((step, index) => ({ ...step, id: `${step.id}:${index}` }));
}

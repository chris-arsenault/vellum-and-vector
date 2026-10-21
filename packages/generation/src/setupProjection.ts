import {
  areaSpace,
  point,
  spatial,
  type Diagnostic,
  type ParameterValues,
  type Profile,
} from "@atlas/domain";
import { atlasFeatureDefinitions, type prepareAtlasGeneration } from "./atlasWorkflow";
import type { GenerationFeature } from "./features";
import type {
  GenerationSetup,
  SetupFeature,
  SetupInvocation,
  SetupSetting,
} from "./generationPresentation";
import { inheritedChannelNames } from "./canonry/inheritedFacts";
import { sequenceStages, type SequenceStage } from "./sequence";
import { processRequirements } from "./productLedger";
import { elapsedYears } from "./processTraits";
import { invocationParameters } from "./preflight";
import type { PublicationDefinition } from "./publication";
import type { MapProcessContract } from "./process";

type Prepared = ReturnType<typeof prepareAtlasGeneration>;
const stages = ["world", "land", "environment", "magic", "people"];

/** A read-only view of the request already resolved and checked by the engine. */
export function projectGenerationSetup(
  prepared: Prepared,
  definitions: readonly GenerationFeature[] = atlasFeatureDefinitions
): GenerationSetup {
  const { source, input } = prepared,
    area = source.world.areas[input.areaId];
  const channels = [...inheritedChannelNames(source, area.id, input.domains.includes("physical"))];
  const context = {
    profile: area.profile,
    inherited:
      Boolean(area.parentId) || (!input.domains.includes("physical") && channels.length > 0),
    channels,
    locatedSources: locatedSources(prepared),
  };
  const invocations = inspectSequence(prepared, definitions, context.inherited);
  const publications = (input.configuration!.inputs?.publications ??
    []) as unknown as PublicationDefinition[];
  const features = definitions.map((feature) =>
    projectFeature(feature, prepared, context, invocations, publications, definitions)
  );
  features.sort(
    (a, b) =>
      stages.indexOf(a.presentation.stage) - stages.indexOf(b.presentation.stage) ||
      a.presentation.order - b.presentation.order ||
      a.id.localeCompare(b.id)
  );
  return {
    context,
    features,
    invocations,
    sharedInvocations: invocations.filter((invocation) => invocation.feature === null),
    publications: structuredClone(
      publications.filter(
        (item) => item.publish !== false && publicationInContext(item, area.profile, definitions)
      )
    ),
    diagnostics: structuredClone(prepared.diagnostics),
  };
}
function inspectSequence(
  prepared: Prepared,
  definitions: readonly GenerationFeature[],
  inherited: boolean
) {
  const result: SetupInvocation[] = [];
  for (const stage of sequenceStages(prepared.input.configuration!.sequence)) {
    if (!stage.invocation) continue;
    const invocation = inspectInvocation(prepared, definitions, stage, inherited, false);
    result.push(invocation);
    const contract = prepared.registry.get(
      stage.invocation.process,
      stage.invocation.version
    ).contract;
    if (!contract.reconciliation) continue;
    for (const child of sequenceStages(
      contract.reconciliation.sequence,
      [...stage.path, "reconciliation"],
      stage.epochs,
      stage.epochIndices
    )) {
      if (!child.invocation) continue;
      const occurrence = inspectInvocation(prepared, definitions, child, inherited, true);
      result.push({ ...occurrence, scheduled: invocation.scheduled && occurrence.scheduled });
    }
  }
  return result;
}
function inspectInvocation(
  prepared: Prepared,
  definitions: readonly GenerationFeature[],
  stage: SequenceStage,
  inherited: boolean,
  reconciliation: boolean
): SetupInvocation {
  const invocation = stage.invocation!,
    process = prepared.registry.get(invocation.process, invocation.version),
    owner = invocationOwner(invocation.feature, invocation.process, definitions);
  return {
    key: JSON.stringify([stage.epochs.map((epoch) => epoch.id), stage.path]),
    id: invocation.id,
    path: [...stage.path],
    process: invocation.process,
    version: invocation.version,
    feature: owner?.id ?? null,
    epochs: stage.epochs.map(({ id, duration }) => ({ id, duration })),
    behavior: process.behavior?.kind ?? "legacy",
    ...invocationDuration(process.behavior, stage, owner, inherited),
    parameters: structuredClone(boundParameters(process.contract, prepared, stage)),
    inputs: structuredClone(processRequirements(process.contract)),
    outputs: [...process.contract.produces],
    invalidates: [...process.contract.invalidates],
    conditional: reconciliation || Boolean(invocation.when),
    reconciliation,
    scheduled: isScheduled(stage),
    reconciliationContract: process.contract.reconciliation
      ? {
          invalidates: [...process.contract.reconciliation.invalidates],
          guarantees: [...process.contract.reconciliation.guarantees],
        }
      : undefined,
  };
}
function invocationOwner(
  id: string | undefined,
  process: string,
  definitions: readonly GenerationFeature[]
) {
  return id
    ? definitions.find((feature) => feature.id === id)
    : definitions.find((feature) => feature.processes.includes(process));
}
function boundParameters(
  contract: MapProcessContract,
  prepared: Prepared,
  stage: SequenceStage
): ParameterValues {
  try {
    return invocationParameters(contract, prepared.input.configuration!, stage);
  } catch {
    return stage.invocation!.parameters ?? {};
  }
}
function invocationDuration(
  behavior: import("./processTraits").ProcessBehavior | undefined,
  stage: SequenceStage,
  owner: GenerationFeature | undefined,
  inherited: boolean
) {
  const duration = boundDuration(behavior, stage),
    preservesAge =
      inherited && owner?.presentation?.inheritedElapsed === "preserve-age" && duration !== null;
  return {
    durationYears: preservesAge ? 0 : duration,
    boundDurationYears: duration,
    durationNote: preservesAge
      ? "Inherited ecology retains its age; this bound response adds no biological time."
      : null,
  };
}
function isScheduled(stage: SequenceStage) {
  const when = stage.invocation!.when;
  if (!when) return true;
  const variables = Object.assign({}, ...stage.epochs.map((epoch) => epoch.variables));
  return variables[when.variable] === when.equals;
}
function boundDuration(
  behavior: import("./processTraits").ProcessBehavior | undefined,
  stage: SequenceStage
) {
  if (behavior?.kind !== "elapsed") return null;
  try {
    return elapsedYears(behavior.duration, stage);
  } catch {
    return null;
  }
}
function projectFeature(
  feature: GenerationFeature,
  prepared: Prepared,
  context: GenerationSetup["context"],
  allInvocations: SetupInvocation[],
  allPublications: PublicationDefinition[],
  definitions: readonly GenerationFeature[]
): SetupFeature {
  const bound = prepared.input.resolvedFeatures!.selection[feature.id];
  const invocations = allInvocations.filter((item) => item.feature === feature.id);
  const publications = allPublications.filter(
    (item) =>
      item.owners?.includes(feature.id) &&
      featurePublicationInContext(
        item,
        prepared.source.world.areas[prepared.input.areaId].profile,
        feature
      )
  );
  const status = featureStatus(feature, bound.enabled, context, invocations, publications);
  const historyFixed =
    context.inherited ||
    prepared.source.world.generations.some((run) => run.domains.includes("physical"));
  return {
    id: feature.id,
    label: feature.label,
    presentation: structuredClone(
      feature.presentation ?? {
        stage: "world",
        family: "Additional capabilities",
        summary: feature.label,
        order: 1000,
      }
    ),
    enabled: bound.enabled,
    ...status,
    settings: Object.entries(feature.settings).map(([key, definition]) =>
      projectSetting(
        feature,
        key,
        definition,
        bound.settings[key],
        status,
        context,
        allInvocations,
        prepared,
        definitions
      )
    ),
    configuration: structuredClone(bound.configuration),
    configurationEditable: bound.enabled && Boolean(feature.configuration) && !historyFixed,
    requires: [...(feature.requires ?? [])],
    requiredBy: atlasDependents(feature, prepared, definitions),
    invocations,
    publications: structuredClone(publications),
    diagnostics: featureDiagnostics(feature, prepared, invocations),
  };
}
function publicationInContext(
  item: PublicationDefinition,
  profile: Profile,
  definitions: readonly GenerationFeature[]
) {
  if (!item.layer.profiles.includes(profile)) return false;
  return (
    !item.owners?.length ||
    item.owners.some((owner) =>
      featurePublicationInContext(
        item,
        profile,
        definitions.find((feature) => feature.id === owner)
      )
    )
  );
}
function featurePublicationInContext(
  item: PublicationDefinition,
  profile: Profile,
  feature?: GenerationFeature
) {
  const supported =
    feature?.presentation?.publicationProfiles?.[item.layer.id] ?? item.layer.profiles;
  return supported.includes(profile);
}
function featureStatus(
  feature: GenerationFeature,
  enabled: boolean,
  context: GenerationSetup["context"],
  invocations: SetupInvocation[],
  publications: PublicationDefinition[]
): Pick<SetupFeature, "status" | "reason"> {
  if (!enabled)
    return { status: "off", reason: "Off in this request; configured values are retained." };
  if (feature.presentation?.requiresLocatedSources && context.locatedSources === 0)
    return {
      status: "unavailable",
      reason:
        "No located magical sources affect this extent. Enabling this capability does not create sources.",
    };
  if (invocations.some((item) => item.scheduled)) return { status: "active", reason: null };
  const inherited =
    context.inherited &&
    publications.some((item) => item.kind === "field" && context.channels.includes(item.channel));
  return inherited
    ? {
        status: "inherited",
        reason:
          "Existing fields supply this geography; this request runs no new operations for it.",
      }
    : {
        status: "unavailable",
        reason: "This profile and generation context schedule no operations for this capability.",
      };
}
function projectSetting(
  feature: GenerationFeature,
  key: string,
  definition: SetupSetting["definition"],
  value: number,
  status: Pick<SetupFeature, "status" | "reason">,
  context: GenerationSetup["context"],
  invocations: SetupInvocation[],
  prepared: Prepared,
  definitions: readonly GenerationFeature[]
): SetupSetting {
  const declared = feature.presentation?.settingConsumers?.[key];
  const consumers = invocations.filter(
    (item) =>
      item.scheduled &&
      (declared
        ? declared.includes(item.process)
        : item.feature === feature.id &&
          Object.hasOwn(prepared.registry.get(item.process, item.version).contract.parameters, key))
  );
  const inherited = context.inherited && feature.presentation?.initialOnlySettings?.includes(key);
  const active = consumers.length > 0 && !inherited;
  return {
    owner: feature.id,
    controlFeature: settingControlFeature(feature, declared, definitions),
    key,
    definition: structuredClone(definition),
    value,
    active,
    reason: settingReason(active, Boolean(inherited), status),
    consumers: consumers.map((item) => item.path.join("/")),
  };
}
function settingControlFeature(
  owner: GenerationFeature,
  consumers: readonly string[] | undefined,
  definitions: readonly GenerationFeature[]
) {
  if (!consumers?.length) return owner.id;
  const candidates = definitions.filter((feature) =>
    consumers.every((process) => feature.processes.includes(process))
  );
  return candidates.length === 1 ? candidates[0].id : owner.id;
}
function settingReason(active: boolean, inherited: boolean, status: Pick<SetupFeature, "reason">) {
  if (active) return null;
  if (inherited) return "This setting is not reapplied to inherited geography.";
  return status.reason ?? "No scheduled operation consumes this setting in this context.";
}
function atlasDependents(
  feature: GenerationFeature,
  prepared: Prepared,
  definitions: readonly GenerationFeature[]
) {
  return definitions
    .filter(
      (candidate) =>
        candidate.requires?.includes(feature.id) &&
        prepared.input.resolvedFeatures!.selection[candidate.id]?.enabled
    )
    .map((candidate) => candidate.id);
}
function featureDiagnostics(
  feature: GenerationFeature,
  prepared: Prepared,
  invocations: SetupInvocation[]
): Diagnostic[] {
  const products = new Set(
    feature.processes.flatMap((id) =>
      prepared.registry
        .contracts()
        .filter((contract) => contract.id === id)
        .flatMap((contract) => contract.produces)
    )
  );
  return structuredClone(
    prepared.diagnostics.filter(
      (diagnostic) =>
        diagnostic.invocation === feature.id ||
        diagnostic.resource === feature.id ||
        products.has(diagnostic.resource ?? "") ||
        invocations.some((item) => diagnostic.invocation?.includes(item.id))
    )
  );
}
function locatedSources(prepared: Prepared) {
  const { source, input } = prepared,
    area = source.world.areas[input.areaId],
    space = areaSpace(source.world, area.id);
  return source.world.magic.filter((magic) => {
    if (magic.systemId || (magic.spaceId && magic.spaceId !== space)) return false;
    const footprint = magic.scope
      ? spatial.intersection(magic.scope, area.footprint)
      : area.footprint;
    return footprint !== null && spatial.distance(point(magic.source), footprint) < magic.radius;
  }).length;
}

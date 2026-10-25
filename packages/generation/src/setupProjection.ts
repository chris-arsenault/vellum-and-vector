import { type Profile } from "@atlas/domain";
import { atlasFeatureDefinitions, type prepareAtlasGeneration } from "./atlasWorkflow";
import { activeLocatedSources } from "./featureDependencies";
import { landmarksInExtent } from "./landmarkSelection";
import type { GenerationFeature } from "./features";
import type { GenerationSetup, SetupFeature, SetupSetting } from "./generationPresentation";
import { inheritedChannelNames } from "./canonry/inheritedFacts";
import { sequenceStages, type SequenceStage } from "./sequence";
import type { PublicationDefinition } from "./publication";

type Prepared = ReturnType<typeof prepareAtlasGeneration>;
type SetupContext = GenerationSetup["context"] & { channels: string[] };
interface ScheduledInvocation {
  id: string;
  process: string;
  version: string;
  feature: string | null;
  scheduled: boolean;
}

/** A read-only view of the request already resolved and checked by the engine. */
export function projectGenerationSetup(
  prepared: Prepared,
  definitions: readonly GenerationFeature[] = atlasFeatureDefinitions
): GenerationSetup {
  const { source, input } = prepared,
    area = source.world.areas[input.areaId];
  const channels = [...inheritedChannelNames(source, area.id, input.domains.includes("physical"))];
  const context = {
    inherited:
      Boolean(area.parentId) || (!input.domains.includes("physical") && channels.length > 0),
    channels,
    locatedSources: activeLocatedSources(source, input).length,
    landmarks: landmarksInExtent(source, input).length,
  };
  const invocations = inspectSequence(prepared, definitions);
  const publications = (input.configuration!.inputs?.publications ??
    []) as unknown as PublicationDefinition[];
  const features = definitions.map((feature) =>
    projectFeature(feature, prepared, context, invocations, publications, definitions)
  );
  return {
    context: {
      inherited: context.inherited,
      locatedSources: context.locatedSources,
      landmarks: context.landmarks,
    },
    features,
  };
}
function inspectSequence(prepared: Prepared, definitions: readonly GenerationFeature[]) {
  const result: ScheduledInvocation[] = [];
  for (const stage of sequenceStages(prepared.input.configuration!.sequence)) {
    if (!stage.invocation) continue;
    const invocation = inspectInvocation(definitions, stage);
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
      const occurrence = inspectInvocation(definitions, child);
      result.push({ ...occurrence, scheduled: invocation.scheduled && occurrence.scheduled });
    }
  }
  return result;
}
function inspectInvocation(
  definitions: readonly GenerationFeature[],
  stage: SequenceStage
): ScheduledInvocation {
  const invocation = stage.invocation!,
    owner = invocationOwner(invocation.feature, invocation.process, definitions);
  return {
    id: invocation.id,
    process: invocation.process,
    version: invocation.version,
    feature: owner?.id ?? null,
    scheduled: isScheduled(stage),
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
function isScheduled(stage: SequenceStage) {
  const when = stage.invocation!.when;
  if (!when) return true;
  const variables = Object.assign({}, ...stage.epochs.map((epoch) => epoch.variables));
  return variables[when.variable] === when.equals;
}
function projectFeature(
  feature: GenerationFeature,
  prepared: Prepared,
  context: SetupContext,
  allInvocations: ScheduledInvocation[],
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
    epochControls: structuredClone(feature.applicability?.epochControls ?? []),
    enabled: bound.enabled,
    ...status,
    settings: Object.entries(feature.settings).map(([key, definition]) =>
      projectSetting(
        feature,
        key,
        definition,
        bound.settings[key],
        context,
        allInvocations,
        prepared,
        definitions
      )
    ),
    configuration: structuredClone(bound.configuration),
    configurationPresentation: structuredClone(feature.configurationPresentation),
    configurationEditable:
      bound.enabled &&
      Boolean(feature.configuration) &&
      (feature.configurationPresentation?.applicability === "any" || !historyFixed),
    invocationIds: invocations.map((item) => item.id),
  };
}
function featurePublicationInContext(
  item: PublicationDefinition,
  profile: Profile,
  feature?: GenerationFeature
) {
  const supported =
    feature?.applicability?.publicationProfiles?.[item.layer.id] ?? item.layer.profiles;
  return supported.includes(profile);
}
function featureStatus(
  feature: GenerationFeature,
  enabled: boolean,
  context: SetupContext,
  invocations: ScheduledInvocation[],
  publications: PublicationDefinition[]
): Pick<SetupFeature, "status" | "reason"> {
  if (!enabled)
    return { status: "off", reason: "Off in this request; configured values are retained." };
  const missing = missingAuthoredInputs(feature, context);
  if (missing) return { status: "unavailable", reason: missing };
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
/** Capabilities that act on map-placed inputs report their absence rather than creating them. */
function missingAuthoredInputs(feature: GenerationFeature, context: SetupContext) {
  if (feature.applicability?.requiresLocatedSources && context.locatedSources === 0)
    return "No located magical sources affect this extent. Enabling this capability does not create sources.";
  if (feature.applicability?.requiresLandmarks && context.landmarks === 0)
    return "No landmarks are placed in this extent. Enabling this capability does not create landmarks.";
  return null;
}
function projectSetting(
  feature: GenerationFeature,
  key: string,
  definition: SetupSetting["definition"],
  value: number,
  context: SetupContext,
  invocations: ScheduledInvocation[],
  prepared: Prepared,
  definitions: readonly GenerationFeature[]
): SetupSetting {
  const declared = feature.applicability?.settingConsumers?.[key];
  const consumers = invocations.filter(
    (item) =>
      item.scheduled &&
      (declared
        ? declared.includes(item.process)
        : item.feature === feature.id &&
          Object.hasOwn(prepared.registry.get(item.process, item.version).contract.parameters, key))
  );
  const inherited = context.inherited && feature.applicability?.initialOnlySettings?.includes(key);
  const active = consumers.length > 0 && !inherited;
  return {
    owner: feature.id,
    controlFeature: settingControlFeature(feature, declared, definitions),
    key,
    definition: structuredClone(definition),
    value,
    active,
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

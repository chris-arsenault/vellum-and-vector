import {
  areaSpace,
  canonryConfluencePresets,
  point,
  spatial,
  locatedMagicEffectDefinitions,
  type MagicConfluence,
  type MagicSystem,
} from "@atlas/domain";
import type { SetupFeature } from "@atlas/generation";
import { MagicSystemsEditor } from "./MagicSystemsForm";
import { MagicConfluencesEditor } from "./MagicConfluencesEditor";
import { NumberField } from "./WorkflowFields";
import { selectedDraftEpoch, epochFieldPrefix } from "./generationEpochFields";
import {
  draftEpochs,
  setDraftConfluences,
  setDraftMagicSystems,
  updateMagicActivity,
} from "./generationDraftEpochs";
import { useWorkflowFields } from "./workflowFieldState";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

export function GenerationMagicConfiguration({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const systems = flow.draft.recipe.features!["magic.configured"].configuration!
    .magicSystems as unknown as MagicSystem[];
  const confluences = (flow.draft.recipe.features!["magic.configured"].configuration!.confluences ??
    canonryConfluencePresets()) as unknown as MagicConfluence[];
  const epoch = selectedDraftEpoch(flow);
  const fields = useWorkflowFields();
  const changeSystems = (next: MagicSystem[]) => {
    const retained = new Set(next.map((system) => system.id));
    for (const system of systems.filter((system) => !retained.has(system.id))) {
      fields.clear(`magic.${system.id}.`);
      for (const epoch of draftEpochs(flow.draft))
        fields.clearExact(`${epochFieldPrefix("magic.configured", epoch.id)}activity.${system.id}`);
    }
    flow.change(setDraftMagicSystems(flow.draft, next));
  };
  if (flow.setup?.context.inherited)
    return (
      <div className="setup-configuration-summary">
        <p>Magical systems and their completed activity are inherited.</p>
        <ul>
          {systems.map((system) => (
            <li key={system.id}>
              {system.name} · {system.enabled ? "active" : "inactive"} ·{" "}
              {system.origins.map((origin) => `${origin.id}: ${origin.propagation}`).join(", ")} ·{" "}
              {epoch.id} activity {epoch.magicActivity?.[system.id] ?? 1}×
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <fieldset className="setup-magic-configuration" disabled={!feature.configurationEditable}>
      <legend>Systems, sources and effects</legend>
      <MagicSystemsEditor systems={systems} change={changeSystems} focusField={flow.targetField} />
      <MagicConfluencesEditor
        confluences={confluences}
        systems={systems}
        change={(next) => flow.change(setDraftConfluences(flow.draft, next))}
      />
      <h4>{epoch.id} · magical activity</h4>
      <div className="setup-setting-grid">
        {systems.map((system) => (
          <NumberField
            key={system.id}
            fieldKey={`${epochFieldPrefix("magic.configured", epoch.id)}activity.${system.id}`}
            label={`${system.name} epoch activity`}
            unit="multiplier"
            value={epoch.magicActivity?.[system.id] ?? 1}
            min={0}
            change={(value) =>
              flow.change(updateMagicActivity(flow.draft, epoch.id, system.id, value))
            }
          />
        ))}
      </div>
      <small className="hint">
        Epoch activity multiplies system strength within the same physical history. Located sources
        are supplied separately.
      </small>
    </fieldset>
  );
}

export function GenerationLocatedSources({ flow }: { flow: GenerationWorkflow }) {
  const source = flow.options.source ?? flow.prepared?.source;
  if (!source || (!flow.options.areaId && !source.world.magic.length))
    return (
      <p className="hint">
        No located sources exist in this new world. This choice uses sources placed on the map; it
        does not create them.
      </p>
    );
  const area = source.world.areas[flow.options.areaId ?? source.scope.areaId],
    space = areaSpace(source.world, area.id);
  const sources = source.world.magic.filter((magic) => {
    if (magic.systemId || (magic.spaceId && magic.spaceId !== space)) return false;
    const footprint = magic.scope
      ? spatial.intersection(magic.scope, area.footprint)
      : area.footprint;
    return footprint && spatial.distance(point(magic.source), footprint) < magic.radius;
  });
  if (!sources.length)
    return (
      <p className="hint">
        No existing located sources affect this extent. Place sources on the map to use this
        capability.
      </p>
    );
  return (
    <table className="setup-located-sources">
      <caption>Existing sources affecting this extent</caption>
      <thead>
        <tr>
          <th scope="col">Source</th>
          <th scope="col">Influence</th>
          <th scope="col">Radius</th>
          <th scope="col">Propagation</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => (
          <tr key={source.id}>
            <th scope="row">{source.name}</th>
            <td>{locatedEffectLabel(source.effect)}</td>
            <td>{source.radius / 1000} km</td>
            <td>{source.propagation}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function locatedEffectLabel(effect: string) {
  const definition =
    locatedMagicEffectDefinitions[effect as keyof typeof locatedMagicEffectDefinitions];
  return `${definition?.label ?? effect}${definition?.physicalFeedback ? "" : " · intensity only; physical feedback not simulated"}`;
}

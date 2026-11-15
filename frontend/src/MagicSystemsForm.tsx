import type {
  MagicOrigin,
  MagicPropagation,
  MagicRenewal,
  MagicSource,
  MagicSystem,
} from "@atlas/context";
import { v4 as uuid } from "uuid";
import { magicRenewals } from "./magicChoices";
import { MagicRuleEditor } from "./MagicRuleEditor";
import { NumberField as NumberSetting } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";
import { magicControlKeys, removedMagicParameterFields } from "./generationMagicControls";
import { magicPresentation, defaultMagicConfiguration } from "./generationPresentation";
import { SetupDisclosure } from "./SetupDisclosure";
import { effectLabels, parameterLabels, renewalLabels } from "./magicLabels";

export function MagicSystemsEditor({
  systems,
  change,
  focusField,
}: {
  systems: MagicSystem[];
  change: (systems: MagicSystem[]) => void;
  focusField?: string;
}) {
  const { clear, clearExact } = useWorkflowFields();
  const update = (updated: MagicSystem) => {
    const previous = systems.find((system) => system.id === updated.id)!;
    for (const key of removedMagicParameterFields(previous, updated)) clearExact(key);
    change(systems.map((system) => (system.id === updated.id ? updated : system)));
  };
  return (
    <>
      {systems.map((system) => (
        <SetupDisclosure
          key={system.id}
          initiallyOpen={focusField?.startsWith("magic." + system.id + ".")}
          title={system.name + (system.enabled ? " · active" : " · inactive")}
        >
          <SystemSettings system={system} change={update} />
          <MagicRuleEditor system={system} systems={systems} change={update} />
          <button
            type="button"
            className="secondary"
            onClick={() =>
              change([
                ...systems,
                {
                  ...structuredClone(system),
                  id: uuid(),
                  name: `${system.name} variant`,
                },
              ])
            }
          >
            Make a variant
          </button>
        </SetupDisclosure>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() => {
          clear("magic.");
          change(defaultMagicConfiguration().magicSystems as unknown as MagicSystem[]);
        }}
      >
        Restore example systems
      </button>
    </>
  );
}
function SystemSettings({
  system,
  change,
}: {
  system: MagicSystem;
  change: (next: MagicSystem) => void;
}) {
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={system.enabled}
          onChange={(event) => change({ ...system, enabled: event.target.checked })}
        />
        Participates in generation
      </label>
      <label>
        System name
        <input
          value={system.name}
          required
          onChange={(event) => change({ ...system, name: event.target.value })}
        />
      </label>
      <SystemPropagation system={system} change={change} />
      <NumberSetting
        fieldKey={`magic.${system.id}.strength`}
        label="Activity multiplier"
        value={system.strength}
        min={0}
        change={(strength) => change({ ...system, strength })}
      />
      <details>
        <summary>Propagation & source controls</summary>
        <PropagationSettings system={system} change={change} />
      </details>
      <SystemFeedback system={system} change={change} />
    </>
  );
}
/** One origin's source, propagation and renewal; a system with several lists them all. */
function OriginSettings({
  origin,
  removable,
  change,
}: {
  origin: MagicOrigin;
  removable: boolean;
  change: (next: MagicOrigin | null) => void;
}) {
  return (
    <fieldset className="magic-origin">
      <legend>Origin · {origin.id}</legend>
      <label>
        Source selection
        <select
          value={origin.source}
          onChange={(event) => change({ ...origin, source: event.target.value as MagicSource })}
        >
          {magicPresentation().sources.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Propagation
        <select
          value={origin.propagation}
          onChange={(event) =>
            change({ ...origin, propagation: event.target.value as MagicPropagation })
          }
        >
          {magicPresentation().propagations.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Renewal
        <select
          value={origin.renewal}
          onChange={(event) => change({ ...origin, renewal: event.target.value as MagicRenewal })}
        >
          {magicRenewals.map((value) => (
            <option key={value} value={value}>
              {renewalLabels[value]}
            </option>
          ))}
        </select>
      </label>
      {removable && (
        <button type="button" className="quiet" onClick={() => change(null)}>
          Remove this origin
        </button>
      )}
    </fieldset>
  );
}
const newOrigin = (n: number): MagicOrigin => ({
  id: `origin-${n}`,
  source: "placed",
  propagation: "radial",
  renewal: "kept",
  parameters: {},
  stocks: [],
});
function SystemPropagation({
  system,
  change,
}: {
  system: MagicSystem;
  change: (next: MagicSystem) => void;
}) {
  const replace = (index: number, origin: MagicOrigin | null) =>
    change({
      ...system,
      origins: origin
        ? system.origins.map((entry, n) => (n === index ? origin : entry))
        : system.origins.filter((_, n) => n !== index),
    });
  return (
    <>
      {system.origins.map((origin, index) => (
        <OriginSettings
          key={origin.id}
          origin={origin}
          removable={system.origins.length > 1}
          change={(next) => replace(index, next)}
        />
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          change({ ...system, origins: [...system.origins, newOrigin(system.origins.length + 1)] })
        }
      >
        Add an origin
      </button>
      <label>
        Acts during
        <select
          value={system.phase}
          onChange={(event) =>
            change({ ...system, phase: event.target.value as MagicSystem["phase"] })
          }
        >
          <option value="climate">Climate, before rivers & glaciers</option>
          <option value="post-glacial">After glacial reconciliation</option>
          <option value="society">Society, once people have acted</option>
        </select>
      </label>
    </>
  );
}
function SystemFeedback({
  system,
  change,
}: {
  system: MagicSystem;
  change: (next: MagicSystem) => void;
}) {
  return (
    <>
      <details>
        <summary>Environmental feedback</summary>
        {(Object.keys(effectLabels) as (keyof MagicSystem["effects"])[]).map((key) => (
          <NumberSetting
            key={key}
            fieldKey={`magic.${system.id}.effects.${key}`}
            label={effectLabels[key]}
            value={system.effects[key]}
            change={(value) => change({ ...system, effects: { ...system.effects, [key]: value } })}
          />
        ))}
      </details>
      <details>
        <summary>History & material storage</summary>
        <NumberSetting
          fieldKey={`magic.${system.id}.history.retention`}
          label="Retained storage per epoch · fraction"
          min={0}
          max={1}
          value={system.history.retention}
          change={(retention) => change({ ...system, history: { ...system.history, retention } })}
        />
        <NumberSetting
          fieldKey={`magic.${system.id}.history.storage`}
          label="Activity stored per epoch · multiplier"
          min={0}
          value={system.history.storage}
          change={(storage) => change({ ...system, history: { ...system.history, storage } })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={system.history.advect}
            onChange={(event) =>
              change({ ...system, history: { ...system.history, advect: event.target.checked } })
            }
          />
          Carry history with moving crust
        </label>
      </details>
    </>
  );
}
function PropagationSettings({
  system,
  change,
}: {
  system: MagicSystem;
  change: (next: MagicSystem) => void;
}) {
  return magicControlKeys(system).map((key) => (
    <NumberSetting
      key={key}
      fieldKey={`magic.${system.id}.parameters.${key}`}
      label={parameterLabels[key]}
      value={system.parameters[key]}
      min={0}
      step={["rayCount", "coastalSources", "wakeSources"].includes(key) ? 1 : "any"}
      change={(value) => change({ ...system, parameters: { ...system.parameters, [key]: value } })}
    />
  ));
}

import { useState } from "react";
import {
  canonryConfluencePresets,
  canonryMagicPresets,
  magicRenewals,
  type MagicOrigin,
  type MagicPropagation,
  type MagicRenewal,
  type MagicSource,
  type MagicSystem,
} from "@atlas/domain";
import type { EditorState } from "./useEditor";
import { MagicRuleEditor } from "./MagicRuleEditor";
import { NumberField as NumberSetting } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";
import { magicControlKeys, removedMagicParameterFields } from "./generationMagicControls";
import { magicSourceOptions, magicPropagationOptions } from "@atlas/generation";
import { SetupDisclosure } from "./SetupDisclosure";
import { MagicConfluencesEditor } from "./MagicConfluencesEditor";

export function MagicSystemsForm({ editor }: { editor: EditorState }) {
  const [systems, setSystems] = useState(editor.world.magicSystems ?? canonryMagicPresets());
  const [confluences, setConfluences] = useState(
    editor.world.confluences ?? canonryConfluencePresets()
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        editor.execute("setMagicSystems", { systems, confluences });
      }}
    >
      <h3>Systems that shape this world</h3>
      <p>
        Fire follows fractures and hardens rock. Aurora drains toward cold and gathers in ice.
        Pressure travels through oceans and changes coasts. Combine or alter these examples below.
      </p>
      <MagicSystemsEditor systems={systems} change={setSystems} />
      <MagicConfluencesEditor confluences={confluences} systems={systems} change={setConfluences} />
      <button className="primary" disabled={editor.commit.isPending}>
        Save magical systems
      </button>
      <p className="hint">
        Save, then apply to the present landscape or generate land and magic together to carry their
        effects through every epoch. Disable a system to leave its place in the configuration while
        removing its active effects from the next generation.
      </p>
    </form>
  );
}
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
                  id: crypto.randomUUID(),
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
          change(canonryMagicPresets());
        }}
      >
        Restore Canonry examples
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
          {magicSourceOptions.map(({ value, label }) => (
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
          {magicPropagationOptions.map(({ value, label }) => (
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
const renewalLabels: Record<MagicRenewal, string> = {
  "conduit-fed": "Conduit-fed · produces while open, seals after its budget",
  accumulating: "Accumulating · gathers across epochs",
  continuous: "Continuous · a standing source",
  finite: "Finite · a stock that only runs down",
  kept: "Kept · maintained by people, decays when abandoned",
  emergent: "Emergent · arises from other systems' fields",
};
const effectLabels = {
  heat: "Heat per intensity unit · 10 units = 1 °C",
  iceMelt: "Ice removed per intensity unit · negative values add ice",
  rockResistance: "Rock resistance change at full intensity · negative values weaken rock",
  coastalForcing: "Coastal forcing · multiplier",
  vegetationGrowth: "Plant growth change at full intensity · −1 to 5",
  fire: "Vegetation burned at full intensity · 0–1",
  organicPreservation: "Organic preservation · −3 accelerates decay, 3 slows decay",
  animalToxicity: "Habitat and forage toxicity · 0–1",
  seedDispersal: "Seed dispersal change · −1 stops spread",
  quickening: "Quickening · living processes run faster, 0–1 at full intensity",
  conduitOpening: "Conduit opening · conductance gained per active epoch, 0–1,000",
  stillness: "Stillness · living processes slow and persist, 0–1 at full intensity",
  icePersistence: "Ice persistence · share of melt prevented by stored charge, 0–1",
  upwelling: "Upwelling where a ray shoals · per-mille per intensity unit, 0–3",
  seaSurface: "Sea-surface temperature on the upwelling band · units per intensity, −1 to 1",
  wakeWarming: "Wake warming · native units, 10 per °C",
  fog: "Fog share on coasts facing an upwelling band · 0–1",
};
const parameterLabels: Record<keyof MagicSystem["parameters"], string> = {
  sourceThreshold: "Minimum source density · 0–1,000",
  maximumSources: "Core-site budget per 5.76 million km² of land",
  sourceSpacing: "Core spacing / radial reach · metres",
  baseCost: "Propagation loss per kilometre",
  conductanceDivisor: "Fracture conductance divisor",
  baseInput: "Cold accumulation input",
  logScale: "Cold accumulation logarithmic scale",
  iceRetention: "Ice retention depth · metres",
  coldRetentionDistance: "Ice capture reference travel distance · metres",
  accumulationArea: "Cold accumulation reference area · m²",
  featureNoiseScale: "Feature variation wavelength · metres",
  rayCount: "Standing rays per core",
  rayDistance: "Ray travel distance · metres",
  coastalRayDistance: "Coastal ray distance · metres",
  wakeDistance: "Wake travel distance · metres",
  beamWidth: "Ray / wake width · metres",
  coastalSources: "Coastal impulses per 20,000 km of shoreline",
  coastalSourceDistance: "Coastal source band · metres",
  wakeSources: "Wake paths per 6.24 million km² of ocean",
  coastalThreshold: "Pressure threshold at coast · 0–999",
  waveAmplification: "Wave amplification",
  currentAmplification: "Current amplification",
  rayDecay: "Ray energy lost per 10 km",
  rayIntensity: "Intensity a full-strength ray deposits per step",
  wakeStrength: "Intensity a wake leaves along its track",
  conduitBudget: "Fire a conduit carries before it seals · summed intensity",
};
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
      step={
        ["maximumSources", "rayCount", "coastalSources", "wakeSources"].includes(key) ? 1 : "any"
      }
      change={(value) => change({ ...system, parameters: { ...system.parameters, [key]: value } })}
    />
  ));
}

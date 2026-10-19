import { useState } from "react";
import { canonryMagicPresets, type MagicSystem } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import { MagicRuleEditor } from "./MagicRuleEditor";

export function MagicSystemsForm({ editor }: { editor: EditorState }) {
  const [systems, setSystems] = useState(editor.world.magicSystems ?? canonryMagicPresets());
  const change = (updated: MagicSystem) =>
    setSystems(systems.map((system) => (system.id === updated.id ? updated : system)));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        editor.execute("setMagicSystems", { systems });
      }}
    >
      <h3>Systems that shape this world</h3>
      <p>
        Fire follows fractures and hardens rock. Aurora drains toward cold and gathers in ice.
        Pressure travels through oceans and changes coasts. Combine or alter these examples below.
      </p>
      {systems.map((system) => (
        <details key={system.id}>
          <summary>
            {system.name}
            {system.enabled ? " · active" : " · inactive"}
          </summary>
          <SystemSettings system={system} change={change} />
          <MagicRuleEditor system={system} systems={systems} change={change} />
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setSystems([
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
        </details>
      ))}
      <button type="button" className="quiet" onClick={() => setSystems(canonryMagicPresets())}>
        Restore Canonry examples
      </button>
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
function SystemPropagation({
  system,
  change,
}: {
  system: MagicSystem;
  change: (next: MagicSystem) => void;
}) {
  return (
    <>
      <label>
        Source selection
        <select
          value={system.source}
          onChange={(event) =>
            change({ ...system, source: event.target.value as MagicSystem["source"] })
          }
        >
          <option value="geothermal">Geothermal maxima & placed cores</option>
          <option value="cold">Cold terrain & high ground</option>
          <option value="deep-ocean">Deep ocean locus</option>
          <option value="placed">Only sources placed on the map</option>
        </select>
      </label>
      <label>
        Propagation
        <select
          value={system.propagation}
          onChange={(event) =>
            change({ ...system, propagation: event.target.value as MagicSystem["propagation"] })
          }
        >
          <option value="fracture">Through connected fractures</option>
          <option value="cold-drainage">Toward colder neighbors, retained in ice</option>
          <option value="ocean-rays">Ocean rays, reflections & wakes</option>
          <option value="radial">Radial falloff</option>
        </select>
      </label>
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
            label={effectLabels[key]}
            value={system.effects[key]}
            change={(value) => change({ ...system, effects: { ...system.effects, [key]: value } })}
          />
        ))}
      </details>
      <details>
        <summary>History & material storage</summary>
        <NumberSetting
          label="Retained storage per epoch · fraction"
          min={0}
          max={1}
          value={system.history.retention}
          change={(retention) => change({ ...system, history: { ...system.history, retention } })}
        />
        <NumberSetting
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
const effectLabels = {
  heat: "Heat per intensity unit · 10 units = 1 °C",
  iceMelt: "Ice removed per intensity unit · negative values add ice",
  rockResistance: "Rock resistance change at full intensity · negative values weaken rock",
  coastalForcing: "Coastal forcing · multiplier",
};
const parameterLabels: Record<keyof MagicSystem["parameters"], string> = {
  sourceThreshold: "Minimum source density · 0–1,000",
  maximumSources: "Maximum cores",
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
  coastalSources: "Coastal wave sources",
  coastalSourceDistance: "Coastal source band · metres",
  wakeSources: "Ancient wake sources",
  coastalThreshold: "Pressure threshold at coast · 0–999",
  waveAmplification: "Wave amplification",
  currentAmplification: "Current amplification",
};
function PropagationSettings({
  system,
  change,
}: {
  system: MagicSystem;
  change: (next: MagicSystem) => void;
}) {
  const keys: (keyof MagicSystem["parameters"])[] =
    system.propagation === "ocean-rays"
      ? [
          "rayCount",
          "rayDistance",
          "coastalRayDistance",
          "wakeDistance",
          "beamWidth",
          "coastalSources",
          "coastalSourceDistance",
          "wakeSources",
          "coastalThreshold",
          "waveAmplification",
          "currentAmplification",
        ]
      : system.propagation === "cold-drainage"
        ? ["baseInput", "logScale", "iceRetention", "coldRetentionDistance", "accumulationArea"]
        : ["sourceSpacing", "baseCost", "conductanceDivisor"];
  keys.push("featureNoiseScale");
  if (system.source === "geothermal") keys.push("maximumSources", "sourceThreshold");
  return keys.map((key) => (
    <NumberSetting
      key={key}
      label={parameterLabels[key]}
      value={system.parameters[key]}
      min={0}
      change={(value) => change({ ...system, parameters: { ...system.parameters, [key]: value } })}
    />
  ));
}
function NumberSetting({
  label,
  value,
  change,
  min,
  max,
}: {
  label: string;
  value: number;
  change: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step="any"
        min={min}
        max={max}
        value={value}
        onChange={(event) => change(Number(event.target.value))}
      />
    </label>
  );
}

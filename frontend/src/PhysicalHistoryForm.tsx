import { useState } from "react";
import type { Epoch, World } from "./types";
import type { EditorState } from "./useEditor";
import { physicalHistoryFixed } from "./physicalHistory";
import { EcologyEpochFields } from "./EcologyEpochFields";

const present: Epoch = {
  id: "Present",
  tectonics: 0.1,
  hydrology: 1,
  ice: 0,
  coasts: 1,
  temperature: 15,
  seaLevel: 0,
};
const histories: Record<string, Epoch[]> = {
  young: [{ ...present, id: "Formation", tectonics: 1 }],
  temperate: [{ ...present, id: "Formation", tectonics: 1 }, present],
  glacial: [
    { ...present, id: "Formation", tectonics: 1 },
    { ...present, id: "Cold age", tectonics: 0.4, ice: 1, temperature: -3, seaLevel: -40 },
    present,
  ],
  cycles: [
    { ...present, id: "Formation", tectonics: 1, volcanism: 1.5, impacts: 2 },
    { ...present, id: "First ice age", ice: 1, temperature: -15, seaLevel: -100 },
    { ...present, id: "Interglacial", ice: 0.2, temperature: 18 },
    { ...present, id: "Second ice age", ice: 1, temperature: -10, seaLevel: -70 },
    present,
  ],
  canonry: [
    {
      ...present,
      id: "Crust assembly",
      tectonics: 1,
      hydrology: 0.18,
      ice: 0.1,
      coasts: 0.12,
      temperature: 29.5,
      seaLevel: 35,
      magicActivity: { fire: 0.65, aurora: 0.16, pressure: 0.32 },
    },
    {
      ...present,
      id: "Orogeny and wet erosion",
      tectonics: 0.85,
      ice: 0.09,
      coasts: 0.58,
      temperature: 38,
      seaLevel: 20,
      magicActivity: { fire: 0.9, aurora: 0.38, pressure: 0.56 },
    },
    {
      ...present,
      id: "Glacial maximum",
      tectonics: 0.36,
      hydrology: 0.62,
      ice: 1,
      coasts: 0.76,
      temperature: 1,
      seaLevel: -45,
      magicActivity: { fire: 0.72, aurora: 1, pressure: 0.76 },
    },
    {
      ...present,
      id: "Retreat and present",
      tectonics: 0.22,
      hydrology: 0.86,
      ice: 0.46,
      temperature: 21.5,
      magicActivity: { fire: 1, aurora: 0.76, pressure: 1 },
    },
  ],
  ecological: [
    {
      ...present,
      id: "Wet expansion",
      temperature: 22,
      ecology: { rainfall: 1.4, seasonality: 0.15, fire: 0.3 },
    },
    {
      ...present,
      id: "Dry fire age",
      temperature: 27,
      ecology: { rainfall: 0.35, seasonality: 0.9, fire: 3 },
    },
    {
      ...present,
      id: "Cold retreat",
      temperature: -8,
      ice: 0.8,
      ecology: { rainfall: 0.7, seasonality: 0.65, migration: 1.5 },
    },
    {
      ...present,
      id: "Refugial recovery",
      temperature: 18,
      ecology: { rainfall: 1.1, seasonality: 0.3, recovery: 1.5 },
    },
  ],
};
export function PhysicalHistoryForm({ world, editor }: { world: World; editor: EditorState }) {
  const [epochs, setEpochs] = useState(world.epochs),
    fixed = physicalHistoryFixed(world);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        editor.execute("setPhysicalEpochs", { epochs });
      }}
    >
      <p>
        Shape the sequence that formed this landscape. Climate and sea-level shifts add to the
        generation baseline.
      </p>
      {fixed && (
        <p className="hint">
          This history is already part of mapped geography. It stays fixed while you edit the
          present.
        </p>
      )}
      <fieldset disabled={fixed}>
        <HistoryPreset change={setEpochs} />
        {epochs.map((epoch, index) => (
          <details key={index}>
            <summary>{epoch.id}</summary>
            <EpochFields
              epoch={epoch}
              systems={world.magicSystems ?? []}
              change={(updated) =>
                setEpochs(epochs.map((current, i) => (i === index ? updated : current)))
              }
            />
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                const reordered = [...epochs];
                [reordered[index - 1], reordered[index]] = [epoch, reordered[index - 1]];
                setEpochs(reordered);
              }}
            >
              Move earlier
            </button>
            <button
              type="button"
              className="quiet"
              disabled={epochs.length === 1}
              onClick={() => setEpochs(epochs.filter((_, i) => i !== index))}
            >
              Remove epoch
            </button>
          </details>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => setEpochs([...epochs, { ...present, id: `Epoch ${epochs.length + 1}` }])}
        >
          Add epoch
        </button>
        <button className="primary" disabled={editor.commit.isPending}>
          Save physical history
        </button>
      </fieldset>
    </form>
  );
}
function HistoryPreset({ change }: { change: (epochs: Epoch[]) => void }) {
  return (
    <label>
      History starting point
      <select
        defaultValue="current"
        onChange={(event) => change(structuredClone(histories[event.target.value]))}
      >
        <option value="current" disabled>
          Current history
        </option>
        <option value="young">Young, active landscape</option>
        <option value="temperate">Temperate history</option>
        <option value="glacial">Glacial past, temperate present</option>
        <option value="cycles">Bombardment & repeated ice ages</option>
        <option value="canonry">Ice Remembers · four Canonry epochs</option>
        <option value="ecological">Ecological cycles · wet, dry, cold and recovery</option>
      </select>
    </label>
  );
}
function EpochFields({
  epoch,
  change,
  systems,
}: {
  epoch: Epoch;
  change: (epoch: Epoch) => void;
  systems: NonNullable<World["magicSystems"]>;
}) {
  const strengths = {
    tectonics: "Tectonic activity",
    hydrology: "River activity",
    ice: "Glacial activity",
    coasts: "Coastal activity",
  } as const;
  return (
    <>
      <label>
        Epoch name
        <input
          value={epoch.id}
          required
          onChange={(event) => change({ ...epoch, id: event.target.value })}
        />
      </label>
      {Object.entries(strengths).map(([key, label]) => (
        <label key={key}>
          {label} · {Math.round(epoch[key as keyof typeof strengths] * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={epoch[key as keyof typeof strengths]}
            onChange={(event) => change({ ...epoch, [key]: Number(event.target.value) })}
          />
        </label>
      ))}
      {systems.map((system) => (
        <label key={system.id}>
          {system.name} activity · multiplier
          <input
            type="number"
            min="0"
            step=".1"
            value={epoch.magicActivity?.[system.id] ?? 1}
            onChange={(event) =>
              change({
                ...epoch,
                magicActivity: { ...epoch.magicActivity, [system.id]: Number(event.target.value) },
              })
            }
          />
        </label>
      ))}
      <EpochClimate epoch={epoch} change={change} />
      <EcologyEpochFields epoch={epoch} change={change} />
    </>
  );
}
function EpochClimate({ epoch, change }: { epoch: Epoch; change: (epoch: Epoch) => void }) {
  return (
    <>
      <label>
        Duration · years
        <input
          type="number"
          min="1"
          value={epoch.duration ?? 1000}
          onChange={(event) => change({ ...epoch, duration: Number(event.target.value) })}
        />
      </label>
      <p className="hint">
        Establishment, migration and succession take time. Ice, drought, disturbance and magical
        activity can change the communities and seed banks inherited by later epochs.
      </p>
      {(["impacts", "volcanism"] as const).map((key) => (
        <label key={key}>
          {key === "impacts" ? "Meteor bombardment" : "Volcanic construction"} · multiplier
          <input
            type="number"
            min="0"
            step=".1"
            value={epoch[key] ?? 1}
            onChange={(event) => change({ ...epoch, [key]: Number(event.target.value) })}
          />
        </label>
      ))}
      <label>
        Climate shift · °C
        <input
          type="number"
          step="any"
          value={epoch.temperature - 15}
          onChange={(event) => change({ ...epoch, temperature: 15 + Number(event.target.value) })}
        />
      </label>
      <label>
        Sea level shift · m
        <input
          type="number"
          step="any"
          value={epoch.seaLevel}
          onChange={(event) => change({ ...epoch, seaLevel: Number(event.target.value) })}
        />
      </label>
    </>
  );
}

import { useState } from "react";
import type { Epoch, World } from "./types";
import type { EditorState } from "./useEditor";
import { physicalHistoryFixed } from "./physicalHistory";

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
        <label>
          History starting point
          <select
            defaultValue="current"
            onChange={(event) => setEpochs(structuredClone(histories[event.target.value]))}
          >
            <option value="current" disabled>
              Current history
            </option>
            <option value="young">Young, active landscape</option>
            <option value="temperate">Temperate history</option>
            <option value="glacial">Glacial past, temperate present</option>
          </select>
        </label>
        {epochs.map((epoch, index) => (
          <details key={index}>
            <summary>{epoch.id}</summary>
            <EpochFields
              epoch={epoch}
              change={(updated) =>
                setEpochs(epochs.map((current, i) => (i === index ? updated : current)))
              }
            />
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
function EpochFields({ epoch, change }: { epoch: Epoch; change: (epoch: Epoch) => void }) {
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

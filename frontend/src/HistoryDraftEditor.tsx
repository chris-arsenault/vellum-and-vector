import type { Epoch, MagicSystem, World } from "@atlas/domain";
import { EpochFields, HistoryPreset } from "./PhysicalHistoryForm";
import { EraFields } from "./HumanEraForm";

export function HistoryDraftEditor({
  epochs,
  systems,
  change,
}: {
  epochs: Epoch[];
  systems: MagicSystem[];
  change: (epochs: Epoch[]) => void;
}) {
  return (
    <>
      <HistoryPreset change={change} />
      {epochs.map((epoch, index) => (
        <details key={index}>
          <summary>{epoch.id || `Epoch ${index + 1}`}</summary>
          <EpochFields
            epoch={epoch}
            systems={systems}
            change={(next) => change(epochs.map((entry, i) => (i === index ? next : entry)))}
          />
          <button
            type="button"
            disabled={index === 0}
            onClick={() => {
              const next = [...epochs];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              change(next);
            }}
          >
            Move earlier
          </button>
          <button
            type="button"
            disabled={epochs.length === 1}
            onClick={() => change(epochs.filter((_, i) => i !== index))}
          >
            Remove epoch
          </button>
        </details>
      ))}
      <button
        type="button"
        onClick={() =>
          change([
            ...epochs,
            { ...structuredClone(epochs.at(-1)!), id: `Epoch ${epochs.length + 1}` },
          ])
        }
      >
        Add epoch
      </button>
    </>
  );
}
type HumanEra = NonNullable<World["humanEras"]>[number];
export function HumanHistoryDraftEditor({
  eras,
  epochs,
  change,
}: {
  eras: HumanEra[];
  epochs: Epoch[];
  change: (eras: HumanEra[]) => void;
}) {
  return (
    <details>
      <summary>Human history</summary>
      {eras.map((era, index) => (
        <HumanEraDraft
          key={index}
          era={era}
          epochs={epochs}
          change={(next) => change(eras.map((entry, i) => (i === index ? next : entry)))}
          remove={() => change(eras.filter((_, i) => i !== index))}
        />
      ))}
      <button
        type="button"
        onClick={() =>
          change([
            ...eras,
            {
              id: `Era ${eras.length + 1}`,
              years: 200,
              physicalEpoch: null,
              mobility: 1,
              politicalCapacity: 1,
            },
          ])
        }
      >
        Add era
      </button>
    </details>
  );
}
function HumanEraDraft({
  era,
  epochs,
  change,
  remove,
}: {
  era: HumanEra;
  epochs: Epoch[];
  change: (era: HumanEra) => void;
  remove: () => void;
}) {
  return (
    <fieldset>
      <EraFields era={era} change={change} />
      <label>
        Physical epoch
        <select
          value={era.physicalEpoch ?? ""}
          onChange={(event) => change({ ...era, physicalEpoch: event.target.value || null })}
        >
          <option value="">Present geography</option>
          {epochs.map((epoch) => (
            <option key={epoch.id} value={epoch.id}>
              {epoch.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Political capacity
        <input
          type="number"
          min="0"
          step="any"
          value={era.politicalCapacity}
          onChange={(event) => change({ ...era, politicalCapacity: Number(event.target.value) })}
        />
      </label>
      <button type="button" onClick={remove}>
        Remove era
      </button>
    </fieldset>
  );
}

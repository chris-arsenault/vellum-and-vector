import { useState } from "react";
import { isStructureMap, structureLevels } from "./structureMaps";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** A building's levels while editing: show one, add a floor above or a cellar below, or
 * remove a level with what is drawn on it. Each change is one undo step in the map store. */
export function RealScaleLevels({ session }: { session: AuthoringSession }) {
  const { map } = session;
  const levels = structureLevels(map);
  const removable = levels.filter((level) => level.number !== 0);
  const [remove, setRemove] = useState("");
  if (!isStructureMap(map)) return null;
  const doomed = removable.find((level) => level.spaceId === remove) ?? removable[0];
  return (
    <section aria-label="Levels" className="real-scale-levels">
      <h3>Levels</h3>
      <ul>
        {levels.map((level) => (
          <li key={level.spaceId}>
            <button type="button" onClick={() => session.showSpace(level.spaceId)}>
              Show {level.label}
            </button>
          </li>
        ))}
      </ul>
      <div role="toolbar" aria-label="Level changes">
        <button
          type="button"
          disabled={session.busy}
          onClick={() => void session.run({ command: "addLevel", below: false })}
        >
          Add floor above
        </button>
        <button
          type="button"
          disabled={session.busy}
          onClick={() => void session.run({ command: "addLevel", below: true })}
        >
          Add cellar below
        </button>
      </div>
      {doomed && (
        <div>
          <label>
            Level to remove
            <select value={doomed.spaceId} onChange={(event) => setRemove(event.target.value)}>
              {removable.map((level) => (
                <option key={level.spaceId} value={level.spaceId}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={session.busy}
            onClick={() => void session.run({ command: "removeLevel", spaceId: doomed.spaceId })}
          >
            Remove {doomed.label}
          </button>
        </div>
      )}
    </section>
  );
}

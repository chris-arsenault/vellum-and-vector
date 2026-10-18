import { useState } from "react";
import type { World } from "./types";
import type { EditorState } from "./useEditor";
type Era = NonNullable<World["humanEras"]>[number];
export function HumanEraForm({ world, editor }: { world: World; editor: EditorState }) {
  const [eras, setEras] = useState(world.humanEras ?? []);
  const fixed = world.generations.some((g) =>
    g.domains.some((d) => d === "cultural" || d === "political")
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        editor.execute("setHumanEras", { eras });
      }}
    >
      <h3>Human history</h3>
      <p className="hint">
        Eras generate the present population and political geography. Completed histories stay fixed
        during ordinary edits.
      </p>
      {eras.map((era, index) => (
        <fieldset key={index} disabled={fixed}>
          <EraFields
            era={era}
            change={(updated) => setEras(eras.map((e, i) => (i === index ? updated : e)))}
          />
        </fieldset>
      ))}
      {!fixed && (
        <>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setEras([
                ...eras,
                {
                  id: `era-${eras.length + 1}`,
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
          <button className="primary">Save human history</button>
        </>
      )}
    </form>
  );
}
function EraFields({ era, change }: { era: Era; change: (era: Era) => void }) {
  return (
    <>
      <label>
        Name
        <input value={era.id} required onChange={(e) => change({ ...era, id: e.target.value })} />
      </label>
      <label>
        Physical context
        <input
          placeholder="Present geography, or an epoch ID"
          value={era.physicalEpoch ?? ""}
          onChange={(e) => change({ ...era, physicalEpoch: e.target.value || null })}
        />
      </label>
      {(["years", "mobility", "politicalCapacity"] as const).map((key) => (
        <label key={key}>
          {eraLabels[key]}
          <input
            type="number"
            min={key === "years" ? "1" : "0"}
            step="any"
            value={era[key]}
            onChange={(e) => change({ ...era, [key]: Number(e.target.value) })}
          />
        </label>
      ))}
    </>
  );
}
const eraLabels = { years: "Years", mobility: "Mobility", politicalCapacity: "Political capacity" };

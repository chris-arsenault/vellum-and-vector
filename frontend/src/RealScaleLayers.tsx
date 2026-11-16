import { useState } from "react";
import type { CreatorLayer } from "@atlas/map";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** Creator layers: where new shapes go, locks, moving the selection, merge down and delete. */
export function RealScaleLayers({ session }: { session: AuthoringSession }) {
  const layers = session.map.realScale?.creatorLayers ?? [];
  const [name, setName] = useState("");
  return (
    <section aria-label="Creator layers">
      <h3>Creator layers</h3>
      <ol className="creator-layers">
        {layers
          .map((layer, index) => ({ layer, index }))
          .reverse()
          .map(({ layer, index }) => (
            <LayerRow
              key={layer.id}
              session={session}
              layer={layer}
              bottom={index === 0}
              only={layers.length === 1}
            />
          ))}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void session.run({ command: "addLayer", name }).then((outcome) => {
            const added = outcome?.map.realScale?.creatorLayers.at(-1);
            if (added) session.set({ target: added.id });
          });
          setName("");
        }}
      >
        <label>
          New layer name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">Add layer</button>
      </form>
    </section>
  );
}
function LayerRow({
  session,
  layer,
  bottom,
  only,
}: {
  session: AuthoringSession;
  layer: CreatorLayer;
  bottom: boolean;
  only: boolean;
}) {
  const { state } = session;
  return (
    <li aria-label={`Layer ${layer.name}`}>
      <label className="check">
        <input
          type="radio"
          name="creator-layer-target"
          checked={state.target === layer.id}
          onChange={() => session.set({ target: layer.id })}
        />
        Draw into {layer.name}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={layer.locked}
          onChange={(event) =>
            void session.run({ command: "lockLayer", id: layer.id, locked: event.target.checked })
          }
        />
        Lock {layer.name}
      </label>
      <button
        disabled={!state.selected.length}
        onClick={() =>
          void session.run({ command: "moveToLayer", ids: state.selected, layer: layer.id })
        }
      >
        Move selection to {layer.name}
      </button>
      <button
        disabled={bottom}
        onClick={() => void session.run({ command: "mergeDown", id: layer.id })}
      >
        Merge {layer.name} down
      </button>
      <button
        disabled={only}
        onClick={() => {
          void session.run({ command: "deleteLayer", id: layer.id }).then((outcome) => {
            if (outcome && state.target === layer.id)
              session.set({ target: outcome.map.realScale?.creatorLayers[0]?.id ?? "" });
          });
        }}
      >
        Delete {layer.name}
      </button>
    </li>
  );
}

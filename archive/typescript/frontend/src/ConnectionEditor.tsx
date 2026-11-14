import { useState } from "react";
import type { Connection, World } from "./types";
import type { EditorState } from "./useEditor";
import { AccessFeature } from "./AccessFeature";
import { useConnections } from "./useWorkspacePresentation";

export function ConnectionEditor({ world, editor }: { world: World; editor: EditorState }) {
  const [id, select] = useState("");
  const connections = useConnections(world, editor.area.id);
  const current = connections.data?.find((connection) => connection.id === id);
  const point =
    editor.selected?.geometry.type === "Point"
      ? editor.selected.geometry.coordinates
      : [editor.area.frame.origin.x, editor.area.frame.origin.y];
  const end = {
    areaId: editor.area.id,
    position: { x: point[0], y: point[1], z: editor.area.frame.origin.z },
    featureId: editor.selected?.id ?? null,
  };
  return (
    <section>
      <h3>Entrances, floors & portals</h3>
      <label>
        Connection
        <select value={id} onChange={(event) => select(event.target.value)}>
          <option value="">New connection</option>
          {connections.data?.map((c) => (
            <option value={c.id} key={c.id}>
              {c.kind}: {world.areas[c.a.areaId]?.name} → {world.areas[c.b.areaId]?.name}
            </option>
          ))}
        </select>
      </label>
      {connections.error && <p role="alert">{connections.error.message}</p>}
      <ConnectionForm
        key={id}
        initial={
          current ?? {
            id: crypto.randomUUID(),
            kind: "entrance",
            a: end,
            b: { ...end, featureId: null },
            flow: 0,
          }
        }
        world={world}
        editor={editor}
      />
    </section>
  );
}

function ConnectionForm({
  initial,
  world,
  editor,
}: {
  initial: Connection;
  world: World;
  editor: EditorState;
}) {
  const [connection, change] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        editor.execute("connectSpaces", { ...connection });
      }}
    >
      <label>
        Kind
        <select
          value={connection.kind}
          onChange={(event) => {
            const kind = event.target.value;
            change((current) => ({ ...current, kind }));
          }}
        >
          {["entrance", "vertical", "portal", "road", "river", "cave"].map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
      </label>
      <p className="hint">
        Entrances and vertical links meet at one horizontal position. Portals can connect distant
        places.
      </p>
      <Endpoint
        title="From"
        value={connection.a}
        world={world}
        change={(a) => change((current) => ({ ...current, a }))}
      />
      <button type="button" className="quiet" onClick={() => change(alignConnection)}>
        Align destination horizontally
      </button>
      <Endpoint
        title="To"
        value={connection.b}
        world={world}
        change={(b) => change((current) => ({ ...current, b }))}
      />
      {connection.kind === "river" && (
        <label>
          Discharge · m³/s
          <input
            type="number"
            min="0"
            step="any"
            value={connection.flow}
            onChange={(event) => {
              const flow = Number(event.target.value);
              change((current) => ({ ...current, flow }));
            }}
          />
        </label>
      )}
      <button className="primary" disabled={editor.commit.isPending}>
        Save connection
      </button>
    </form>
  );
}
function alignConnection(connection: Connection): Connection {
  return {
    ...connection,
    b: { ...connection.b, position: { ...connection.a.position, z: connection.b.position.z } },
  };
}

function Endpoint({
  title,
  value,
  world,
  change,
}: {
  title: string;
  value: Connection["a"];
  world: World;
  change: (end: Connection["a"]) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <label>
        Mapped area
        <select
          value={value.areaId}
          onChange={(event) => change({ ...value, areaId: event.target.value, featureId: null })}
        >
          {Object.values(world.areas).map((area) => (
            <option value={area.id} key={area.id}>
              {area.name} · {area.frame.floor ?? area.profile}
            </option>
          ))}
        </select>
      </label>
      <AccessFeature key={value.areaId} world={world} value={value} change={change} />
      <EndpointCoordinates value={value} change={change} />
    </fieldset>
  );
}
function EndpointCoordinates({
  value,
  change,
}: {
  value: Connection["a"];
  change: (end: Connection["a"]) => void;
}) {
  return (
    <>
      {(["x", "y", "z"] as const).map((axis) => (
        <label key={axis}>
          {axis.toUpperCase()} · m
          <input
            type="number"
            step="any"
            required
            value={value.position[axis]}
            onChange={(event) =>
              change({
                ...value,
                position: { ...value.position, [axis]: Number(event.target.value) },
              })
            }
          />
        </label>
      ))}
    </>
  );
}

import { useState } from "react";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Connection, World } from "./types";
import type { EditorState } from "./useEditor";
import { useScene } from "./useScene";

export function ConnectionEditor({ world, editor }: { world: World; editor: EditorState }) {
  const [id, select] = useState("");
  const current = world.connections?.[id];
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
          {Object.values(world.connections ?? {}).map((c) => (
            <option value={c.id} key={c.id}>
              {c.kind}: {world.areas[c.a.areaId]?.name} → {world.areas[c.b.areaId]?.name}
            </option>
          ))}
        </select>
      </label>
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
  function align() {
    change({
      ...connection,
      b: { ...connection.b, position: { ...connection.a.position, z: connection.b.position.z } },
    });
  }
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
          onChange={(event) => change({ ...connection, kind: event.target.value })}
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
        change={(a) => change({ ...connection, a })}
      />
      <button type="button" className="quiet" onClick={align}>
        Align destination horizontally
      </button>
      <Endpoint
        title="To"
        value={connection.b}
        world={world}
        change={(b) => change({ ...connection, b })}
      />
      {connection.kind === "river" && (
        <label>
          Discharge · m³/s
          <input
            type="number"
            min="0"
            step="any"
            value={connection.flow}
            onChange={(event) => change({ ...connection, flow: Number(event.target.value) })}
          />
        </label>
      )}
      <button className="primary" disabled={editor.commit.isPending}>
        Save connection
      </button>
    </form>
  );
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
  const scene = useScene(world, value.areaId);
  function attach(id: string) {
    const feature = scene.data?.find((f) => f.id === id);
    const coordinates = feature
      ? new GeoJSON()
          .readGeometry(feature.geometry)
          ?.getClosestPoint([value.position.x, value.position.y])
      : null;
    change({
      ...value,
      featureId: feature?.id ?? null,
      position: coordinates
        ? {
            x: coordinates[0],
            y: coordinates[1],
            z:
              typeof feature?.attributes.elevation === "number"
                ? feature.attributes.elevation
                : value.position.z,
          }
        : value.position,
    });
  }
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
      <label>
        Access feature
        <select value={value.featureId ?? ""} onChange={(event) => attach(event.target.value)}>
          <option value="">Located endpoint without feature</option>
          {scene.data?.map((feature) => (
            <option value={feature.id} key={feature.id}>
              {feature.name}
            </option>
          ))}
        </select>
      </label>
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

import { useState } from "react";
import type { Layer, World } from "./types";
import type { EditorState } from "./useEditor";
interface Spec {
  name: string;
  type: string;
  required: boolean;
}
export function CustomLayer({ world, editor }: { world: World; editor: EditorState }) {
  const [editing, select] = useState("");
  return (
    <>
      <label>
        Edit layer
        <select value={editing} onChange={(e) => select(e.target.value)}>
          <option value="">New custom layer</option>
          {Object.values(world.layers)
            .filter((l) => l.family === "custom")
            .map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </label>
      <LayerForm key={editing} layer={world.layers[editing]} editor={editor} />
    </>
  );
}
function LayerForm({ layer, editor }: { layer: Layer | undefined; editor: EditorState }) {
  const [attributes, setAttributes] = useState<Spec[]>(() =>
    layer
      ? Object.entries(layer.schema).map(([name, value]) => ({
          name,
          ...(value as { type: string; required: boolean }),
        }))
      : [{ name: "", type: "string", required: false }]
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        editor.execute(
          "putLayer",
          layerInput(new FormData(event.currentTarget), layer, attributes)
        );
      }}
    >
      <h3>{layer ? "Edit world layer" : "Add a world layer"}</h3>
      <p className="hint">
        A survey, sightings, sacred places or any other geographic theme. No generator is required.
      </p>
      <label>
        Name
        <input name="name" required defaultValue={layer?.name} />
      </label>
      <label>
        Layer ID
        <input
          name="id"
          required
          disabled={!!layer}
          defaultValue={layer?.id}
          pattern="[a-z][a-z0-9-]*"
          placeholder="archaeology"
        />
      </label>
      <label>
        Representation
        <select name="representation" defaultValue={layer?.representation}>
          <option>vector</option>
          <option>field</option>
          <option>network</option>
        </select>
      </label>
      {attributes.map((attribute, index) => (
        <AttributeSpec
          key={index}
          value={attribute}
          change={(updated) => setAttributes(attributes.map((a, i) => (i === index ? updated : a)))}
          remove={() => setAttributes(attributes.filter((_, i) => i !== index))}
        />
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() =>
          setAttributes([...attributes, { name: "", type: "string", required: false }])
        }
      >
        Add attribute
      </button>
      <button className="primary" disabled={editor.commit.isPending}>
        {layer ? "Save world layer" : "Create world layer"}
      </button>
    </form>
  );
}
function AttributeSpec({
  value,
  change,
  remove,
}: {
  value: Spec;
  change: (spec: Spec) => void;
  remove: () => void;
}) {
  return (
    <fieldset>
      <legend>Attribute</legend>
      <label>
        Attribute name
        <input value={value.name} onChange={(e) => change({ ...value, name: e.target.value })} />
      </label>
      <label>
        Attribute type
        <select value={value.type} onChange={(e) => change({ ...value, type: e.target.value })}>
          <option>string</option>
          <option>number</option>
          <option>boolean</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value.required}
          onChange={(e) => change({ ...value, required: e.target.checked })}
        />
        Require attribute
      </label>
      <button type="button" className="quiet" onClick={remove}>
        Remove attribute
      </button>
    </fieldset>
  );
}
function layerInput(form: FormData, layer: Layer | undefined, attributes: Spec[]) {
  return {
    ...layer,
    id: layer?.id ?? String(form.get("id")),
    name: String(form.get("name")),
    family: "custom",
    representation: String(form.get("representation")),
    color: layer?.color ?? "#e4bb76",
    profiles: ["world", "region", "local", "site", "interior"],
    schema: Object.fromEntries(
      attributes
        .filter((a) => a.name)
        .map((a) => [a.name, { type: a.type, required: !!a.required }])
    ),
    generator: null,
  };
}

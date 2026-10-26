import { useState } from "react";
import type { AtlasFeature, World } from "./types";
import type { EditorState } from "./useEditor";
import { newFeature } from "./useEditor";
import { makeCommand } from "./useAtlas";
import { AttributeEditor } from "./AttributeEditor";
import { RelationshipEditor } from "./RelationshipEditor";

export function FeatureForm({ world, editor }: { world: World; editor: EditorState }) {
  const geometry = editor.drawing;
  const draft = editor.selected ?? {
    layerId: "pois",
    attributes: {},
    relations: [],
    name: "",
    kind: "poi",
  };
  const [layerId, setLayerId] = useState(draft.layerId);
  const [attributes, setAttributes] = useState<Record<string, unknown>>(draft.attributes);
  const [relations, setRelations] = useState<AtlasFeature["relations"]>(draft.relations);
  if (!geometry) return <p>Choose a drawing tool to create a located feature.</p>;
  return (
    <section>
      <p className="eyebrow">NEW SPATIAL FEATURE</p>
      <h2>Add to {editor.area.name}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submitDraft(world, editor, form, { layerId, attributes, relations });
        }}
      >
        <label>
          Name
          <input name="name" required defaultValue={draft.name} placeholder="Name this feature" />
        </label>
        <FeatureKind kind={draft.kind} />
        <label>
          World layer
          <select name="layer" value={layerId} onChange={(e) => setLayerId(e.target.value)}>
            {Object.values(world.layers).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <AttributeEditor
          values={attributes}
          schema={world.layers[layerId].schema}
          change={setAttributes}
        />
        <RelationshipEditor
          world={world}
          features={editor.scene.data ?? []}
          value={relations}
          change={setRelations}
        />
        <ShapeOptions editor={editor} type={geometry.type} />
        <p className="hint">
          This feature will be authored and protected. Its location and locked interfaces are
          checked before it is added.
        </p>
        <button className="primary" disabled={editor.commit.isPending}>
          Create feature
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            editor.setDrawing(null);
            editor.setPanel("inspect");
          }}
        >
          Discard drawing
        </button>
      </form>
    </section>
  );
}
function submitDraft(
  world: World,
  editor: EditorState,
  form: FormData,
  properties: {
    layerId: string;
    attributes: Record<string, unknown>;
    relations: AtlasFeature["relations"];
  }
) {
  const feature = newFeature(
    editor.area,
    editor.drawing!,
    String(form.get("name")),
    String(form.get("kind")),
    properties.layerId
  );
  if (editor.selected && !world.features[editor.selected.id]) feature.id = editor.selected.id;
  feature.attributes = {
    ...booleanDefaults(world.layers[properties.layerId].schema),
    ...properties.attributes,
  };
  feature.relations = properties.relations;
  createFeature(world, editor, feature, form);
}
function booleanDefaults(schema: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([, spec]) => (spec as { type: string }).type === "boolean")
      .map(([key]) => [key, false])
  );
}
function createFeature(world: World, editor: EditorState, feature: AtlasFeature, form: FormData) {
  const { geometry } = feature;
  let kind = "putMapFeature";
  let data: Record<string, unknown> = { areaId: editor.area.id, feature };
  if (geometry.type === "Point" && form.get("terrain") === "on") {
    kind = "putLandform";
    data = {
      areaId: editor.area.id,
      name: feature.name,
      center: {
        x: geometry.coordinates[0],
        y: geometry.coordinates[1],
        z: editor.area.frame.origin.z,
      },
      radius: Number(form.get("radius")),
      height: Number(form.get("height")),
    };
  }
  if (
    geometry.type === "LineString" &&
    form.get("route") === "on" &&
    ["road", "river", "cave"].includes(feature.kind)
  ) {
    kind = "routeNetwork";
    data = {
      areaId: editor.area.id,
      name: feature.name,
      kind: feature.kind,
      waypoints: geometry.coordinates.map((p) => ({
        x: p[0],
        y: p[1],
        z: editor.area.frame.origin.z,
      })),
      startFeatureId: String(form.get("startFeature")) || null,
      endFeatureId: String(form.get("endFeature")) || null,
      flow: Number(form.get("flow") ?? 1),
    };
  }
  editor.commit.mutate(makeCommand(world, kind, data), {
    onSuccess: () => {
      editor.setDrawing(null);
      editor.setSelected(kind === "putMapFeature" ? feature : null);
      editor.setPanel("inspect");
    },
  });
}
function ShapeOptions({ editor, type }: { editor: EditorState; type: string }) {
  if (type === "Point")
    return (
      <fieldset>
        <legend>Terrain landform</legend>
        <label className="check">
          <input type="checkbox" name="terrain" />
          Sculpt this point into the elevation field
        </label>
        <label>
          Height change · m<input type="number" name="height" step="any" defaultValue="50" />
        </label>
        <label>
          Radius · m<input type="number" name="radius" min=".01" step="any" defaultValue="100" />
        </label>
      </fieldset>
    );
  if (type !== "LineString") return null;
  const networks =
    editor.scene.data?.filter((f) => ["road", "river", "cave"].includes(f.kind)) ?? [];
  return (
    <fieldset>
      <legend>Network routing</legend>
      <label className="check">
        <input type="checkbox" name="route" />
        Route through terrain between these waypoints
      </label>
      {["start", "end"].map((end) => (
        <label key={end}>
          Attach {end}
          <select name={`${end}Feature`}>
            <option value="">Unattached</option>
            {networks.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label>
        River discharge · m³/s
        <input type="number" name="flow" min="0" step="any" defaultValue="1" />
      </label>
    </fieldset>
  );
}
function FeatureKind({ kind }: { kind: string }) {
  const kinds = [
    "poi",
    "river",
    "road",
    "building",
    "room",
    "wall",
    "door",
    "stairs",
    "furniture",
    "forest",
    "peak",
    "settlement",
    "sovereignty",
    "dispute",
    "cave",
    "survey",
  ];
  return (
    <label>
      Feature type
      <input name="kind" list="feature-kinds" defaultValue={kind} required />
      <datalist id="feature-kinds">
        {kinds.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </label>
  );
}

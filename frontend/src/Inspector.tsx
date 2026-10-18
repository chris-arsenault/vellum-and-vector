import { useState } from "react";
import { AttributeEditor } from "./AttributeEditor";
import { RelationshipEditor } from "./RelationshipEditor";
import type { AtlasFeature, World } from "./types";
import type { EditorState } from "./useEditor";

export function Inspector({ world, editor }: { world: World; editor: EditorState }) {
  const feature =
    editor.scene.data?.find((f) => f.id === editor.selected?.id) ??
    (editor.selected && world.features[editor.selected.id] ? editor.selected : null);
  if (!feature) return <AreaContext editor={editor} />;
  return <FeatureInspection world={world} editor={editor} feature={feature} />;
}
function AreaContext({ editor }: { editor: EditorState }) {
  return (
    <section>
      <p className="eyebrow">GEOGRAPHIC CONTEXT</p>
      <h2>{editor.area.name}</h2>
      <p>Select a feature to inspect its identity, attributes and provenance.</p>
      <dl>
        <dt>Creation profile</dt>
        <dd>{editor.area.profile}</dd>
        <dt>World origin</dt>
        <dd>
          {editor.area.frame.origin.x}, {editor.area.frame.origin.y}
        </dd>
        <dt>Elevation / floor</dt>
        <dd>
          {editor.area.frame.origin.z} m · {editor.area.frame.floor ?? "surface"}
        </dd>
      </dl>
    </section>
  );
}
function FeatureInspection({
  world,
  editor,
  feature,
}: {
  world: World;
  editor: EditorState;
  feature: AtlasFeature;
}) {
  return (
    <section>
      <p className="eyebrow">
        {feature.kind} · {feature.state}
      </p>
      <h2>{feature.name}</h2>
      <dl>
        <dt>Layer</dt>
        <dd>{world.layers[feature.layerId].name}</dd>
        <dt>Stable feature ID</dt>
        <dd className="mono">{feature.id}</dd>
        <dt>Source</dt>
        <dd>{feature.actor}</dd>
        <dt>Authored protection</dt>
        <dd>{feature.protected ? "Protected from regeneration" : "Regeneratable"}</dd>
      </dl>
      <FeatureEditor key={feature.id} feature={feature} editor={editor} world={world} />
      {feature.geometry.type === "Point" && (
        <button className="secondary" onClick={() => editor.refinePoi(feature)}>
          Refine this place
        </button>
      )}
      {["Polygon", "MultiPolygon"].includes(feature.geometry.type) && (
        <button
          className="secondary"
          onClick={() => {
            editor.setSelection(feature.geometry);
            editor.setPanel("refine");
          }}
        >
          Refine this footprint
        </button>
      )}
      <details>
        <summary>Causes & relationships</summary>
        <ul>
          {feature.causes.map((cause, i) => (
            <li key={i}>{cause}</li>
          ))}
        </ul>
        <pre>{JSON.stringify(feature.relations, null, 2)}</pre>
      </details>
      <details>
        <summary>Detailed representations</summary>
        <ul>
          {Object.entries(feature.detail).map(([id, detail]) => (
            <li key={id}>
              {world.areas[id].name} · {detail.state}
              {detail.needsReconciliation ? " · needs reconciliation" : ""}
            </li>
          ))}
        </ul>
      </details>
      <button
        className="danger quiet"
        onClick={() => editor.execute("deleteFeature", { featureId: feature.id })}
      >
        Delete feature
      </button>
    </section>
  );
}
function FeatureEditor({
  feature,
  editor,
  world,
}: {
  feature: AtlasFeature;
  editor: EditorState;
  world: World;
}) {
  const [attributes, setAttributes] = useState(feature.attributes);
  const [relations, setRelations] = useState(feature.relations);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        editor.saveFeature({
          ...feature,
          name: String(form.get("name")),
          attributes,
          relations,
          protected: form.get("protected") === "on",
        });
      }}
    >
      <label>
        Name
        <input name="name" defaultValue={feature.name} required />
      </label>
      <AttributeEditor
        values={attributes}
        schema={world.layers[feature.layerId].schema}
        change={setAttributes}
      />
      <RelationshipEditor
        world={world}
        features={editor.scene.data ?? []}
        value={relations}
        change={setRelations}
      />
      <label className="check">
        <input type="checkbox" name="protected" defaultChecked={feature.protected} />
        Protect authored feature
      </label>
      <button className="primary" disabled={editor.commit.isPending}>
        Save feature
      </button>
    </form>
  );
}

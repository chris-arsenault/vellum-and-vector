import { useState } from "react";
import type { AtlasFeature, World } from "./types";
import type { EditorState } from "./useEditor";
import { newFeature } from "./useEditor";
import { AttributeEditor } from "./AttributeEditor";
import { RelationshipEditor } from "./RelationshipEditor";
import { FrameFields } from "./FormFields";

export function EntityEditor({ world, editor }: { world: World; editor: EditorState }) {
  const [selected, select] = useState("");
  return (
    <section>
      <h3>People, states & institutions</h3>
      <label>
        Entity
        <select value={selected} onChange={(e) => select(e.target.value)}>
          <option value="">New entity</option>
          {Object.values(world.entities).map((entity) => (
            <option value={entity.id} key={entity.id}>
              {entity.name} · {entity.kind}
            </option>
          ))}
        </select>
      </label>
      <EntityForm key={selected} id={selected} world={world} editor={editor} />
    </section>
  );
}
const originKinds: Record<string, string> = {
  culture: "culturalOrigin",
  polity: "capital",
  religion: "religiousCenter",
};
const originLayers: Record<string, string> = {
  culture: "cultures",
  language: "languages",
  religion: "religions",
};
function EntityForm({ id, world, editor }: { id: string; world: World; editor: EditorState }) {
  const entity = world.entities[id];
  const [kind, setKind] = useState(entity?.kind ?? "culture");
  const [attributes, setAttributes] = useState(entity?.attributes ?? { initialPopulation: 100 });
  const [relations, setRelations] = useState(entity?.relations ?? []);
  const [located, setLocated] = useState(!entity);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const identity = id || crypto.randomUUID();
        const values = { ...attributes };
        const origin = located ? locatedOrigin(form, editor, kind, identity) : undefined;
        if (origin)
          values.center = {
            x: Number(form.get("x")),
            y: Number(form.get("y")),
            z: Number(form.get("z")),
          };
        editor.execute("putEntity", {
          id: identity,
          name: String(form.get("name")),
          kind,
          attributes: values,
          relations,
          ...(origin ? { origin } : {}),
        });
      }}
    >
      <label>
        Name
        <input name="name" required defaultValue={entity?.name} />
      </label>
      <label>
        Kind
        <input
          list="entity-kinds"
          value={kind}
          disabled={!!entity}
          onChange={(e) => setKind(e.target.value)}
          required
        />
      </label>
      <EntityKinds />
      <AttributeEditor values={attributes} change={setAttributes} />
      <RelationshipEditor
        world={world}
        features={editor.scene.data ?? []}
        value={relations}
        change={setRelations}
      />
      <label className="check">
        <input type="checkbox" checked={located} onChange={(e) => setLocated(e.target.checked)} />
        Create or update its located origin in this mapped area
      </label>
      {located && <FrameFields origin={entityPosition(attributes, editor)} />}
      <button className="primary" disabled={editor.commit.isPending}>
        Save entity
      </button>
    </form>
  );
}
function EntityKinds() {
  return (
    <datalist id="entity-kinds">
      {[
        "culture",
        "language",
        "religion",
        "polity",
        "community",
        "settlement",
        "institution",
        "guild",
        "person",
      ].map((k) => (
        <option key={k}>{k}</option>
      ))}
    </datalist>
  );
}
function entityPosition(attributes: Record<string, unknown>, editor: EditorState) {
  return (
    (attributes.center as { x: number; y: number; z: number } | undefined) ??
    editor.area.frame.origin
  );
}
function locatedOrigin(
  form: FormData,
  editor: EditorState,
  kind: string,
  identity: string
): { areaId: string; feature: AtlasFeature } {
  const point = { x: Number(form.get("x")), y: Number(form.get("y")), z: Number(form.get("z")) };
  const feature = newFeature(
    editor.area,
    { type: "Point", coordinates: [point.x, point.y] },
    `${String(form.get("name"))} origin`,
    originKinds[kind] ?? "institution",
    originLayers[kind] ?? "settlements"
  );
  feature.id = "00000000-0000-0000-0000-000000000000";
  feature.attributes = { elevation: point.z };
  feature.relations = [{ targetId: identity, kind: "originOf" }];
  return { areaId: editor.area.id, feature };
}

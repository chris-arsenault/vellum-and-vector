import type { Template } from "./types";
import type { EditorState } from "./useEditor";
import { FrameFields } from "./FormFields";
import { frameAt } from "./presentation";
import { templateUse } from "./templateEditing";

export function TemplateSettings({
  editing,
  saving,
  submit,
  detach,
}: {
  editing: Template | null;
  saving: boolean;
  submit: (form: FormData) => void;
  detach: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      <label>
        Template name
        <input
          name="name"
          required
          defaultValue={editing?.name ?? ""}
          placeholder="Tavern ground floor"
        />
      </label>
      <label>
        Use
        <input name="use" defaultValue={templateUse(editing)} />
      </label>
      <label>
        Institution / owner
        <input name="owner" defaultValue={editing?.entities?.[0]?.name ?? ""} />
      </label>
      <TemplateRequirements editing={editing} />
      <button className="secondary" disabled={saving}>
        Save reusable template
      </button>
      {editing && (
        <button type="button" className="quiet" onClick={detach}>
          Copy as a new definition
        </button>
      )}
    </form>
  );
}
function TemplateRequirements({ editing }: { editing: Template | null }) {
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          name="structure"
          defaultChecked={!!editing?.requirements?.contextKinds?.includes("building")}
        />
        Require a located building footprint
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="bindAccess"
          defaultChecked={editing?.requirements?.streetAccess}
        />
        Bind the first ground-floor door to street access
      </label>
      <label className="check">
        <input type="checkbox" name="recipe" defaultChecked={!!editing?.recipe} />
        Generate connected walls and furnishings after placement
      </label>
      <label>
        Recipe seed
        <input type="number" name="seed" defaultValue={editing?.recipe?.seed ?? 1} />
      </label>
    </>
  );
}
export function TemplatePlacement({
  template,
  editor,
}: {
  template: Template;
  editor: EditorState;
}) {
  const selected = editor.selected;
  const socket = template.sockets?.find((s) => s.required && !s.connectsTo);
  const origin = placementOrigin(template, editor);
  return (
    <section>
      <button className="primary" onClick={() => editor.placeTemplate(template)}>
        Place {template.name} on map
      </button>
      <details>
        <summary>Precise placement & access binding</summary>
        <form
          key={`${template.id}:${selected?.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            editor.execute("instantiateTemplate", {
              templateId: template.id,
              definitionVersion: template.version ?? 1,
              parentId: editor.area.id,
              name: String(form.get("name")),
              frame: frameAt(
                Number(form.get("x")),
                Number(form.get("y")),
                Number(form.get("z")),
                Number(form.get("rotation")),
                String(form.get("floor")) || null
              ),
              contextFeatureId: contextFeature(editor),
              bindings: socket && selected ? { [socket.id]: selected.id } : {},
            });
          }}
        >
          <small>
            Requires {template.parentProfiles.join(" / ")} parent
            {socket ? " · select the target door or access feature" : ""}
          </small>
          <label>
            Instance name
            <input name="name" defaultValue={template.name} required />
          </label>
          <FrameFields origin={origin} floorLabel="Floor" />
          <button className="primary">Place located instance</button>
        </form>
      </details>
    </section>
  );
}
function contextFeature(editor: EditorState) {
  const selected = editor.selected;
  return selected?.kind === "building"
    ? selected.id
    : (selected?.relations.find((r) => r.kind === "entranceTo")?.targetId ?? null);
}
function placementOrigin(template: Template, editor: EditorState) {
  const selected = editor.selected;
  const socket = template.sockets?.find((s) => s.required && !s.connectsTo);
  const origin = { ...editor.area.frame.origin };
  if (selected?.geometry.type !== "Point" || !socket) return origin;
  const position = selected.geometry.coordinates;
  const scale = template.frame.metresPerUnit;
  const angle = (template.frame.rotation * Math.PI) / 180;
  origin.x =
    position[0] -
    template.frame.origin.x -
    scale * (socket.position.x * Math.cos(angle) - socket.position.y * Math.sin(angle));
  origin.y =
    position[1] -
    template.frame.origin.y -
    scale * (socket.position.x * Math.sin(angle) + socket.position.y * Math.cos(angle));
  origin.z =
    (typeof selected.attributes.elevation === "number" ? selected.attributes.elevation : origin.z) -
    template.frame.origin.z -
    socket.position.z * scale;
  return origin;
}

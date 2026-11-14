import { useState } from "react";
import type { World } from "./types";
import type { EditorState } from "./useEditor";
import { MagicForm } from "./MagicForm";
import { TemplateStudio } from "./TemplateStudio";
import { HistoryPanel } from "./HistoryPanel";
import { HumanEraForm } from "./HumanEraForm";
import { CustomLayer } from "./CustomLayer";
import { EntityEditor } from "./EntityEditor";
import { AnalysisPanel } from "./AnalysisPanel";
import { ConnectionEditor } from "./ConnectionEditor";

export function AdvancedPanel({ world, editor }: { world: World; editor: EditorState }) {
  const [section, setSection] = useState("templates");
  return (
    <section>
      <p className="eyebrow">WORLD AUTHORING</p>
      <h2>Systems & tools</h2>
      <label>
        Workspace
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="templates">Templates</option>
          <option value="magic">Magical systems</option>
          <option value="entities">People, states & institutions</option>
          <option value="analysis">Spatial analysis</option>
          <option value="connections">Entrances, floors & portals</option>
          <option value="layer">Custom GIS layer</option>
          <option value="traits">Traits & exceptions</option>
          <option value="history">History & undo</option>
        </select>
      </label>
      {section === "templates" && <TemplateStudio world={world} editor={editor} />}
      {section === "magic" && <MagicForm editor={editor} />}
      {section === "entities" && <EntityEditor world={world} editor={editor} />}
      {section === "analysis" && <AnalysisPanel world={world} editor={editor} />}
      {section === "connections" && <ConnectionEditor world={world} editor={editor} />}
      {section === "layer" && (
        <>
          <CustomLayer world={world} editor={editor} />
          <FieldInitializer world={world} editor={editor} />
        </>
      )}
      {section === "traits" && <TraitForm editor={editor} />}
      {section === "history" && (
        <>
          <HumanEraForm world={world} editor={editor} />
          <HistoryPanel world={world} />
        </>
      )}
    </section>
  );
}
function TraitForm({ editor }: { editor: EditorState }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        editor.execute("setTraits", {
          areaId: editor.area.id,
          traits: [
            ...(editor.area.localTraits ?? []),
            {
              field: String(form.get("field")),
              kind: String(form.get("kind")),
              minimum: Number(form.get("minimum")),
              maximum: Number(form.get("maximum")),
              cause: String(form.get("cause")) || null,
              scope: editor.selection ?? editor.area.footprint,
            },
          ],
        });
      }}
    >
      <h3>Constrain this area</h3>
      <label>
        Field
        <select name="field">
          <option>relief</option>
          <option>temperature</option>
          <option>elevation</option>
          <option>moisture</option>
        </select>
      </label>
      <label>
        Trait class
        <select name="kind">
          <option value="hard">Hard constraint</option>
          <option value="tendency">Soft tendency</option>
          <option value="exception">Scoped exception</option>
        </select>
      </label>
      <div className="form-row">
        <label>
          Minimum
          <input name="minimum" type="number" defaultValue="0" required />
        </label>
        <label>
          Maximum
          <input name="maximum" type="number" defaultValue="30" required />
        </label>
      </div>
      <label>
        Cause / source
        <input name="cause" placeholder="Required for an exception" />
      </label>
      <p className="hint">
        An exception uses the selected geographic extent, or the current mapped area. Inherited hard
        constraints can only be narrowed.
      </p>
      <button className="primary">Apply trait</button>
    </form>
  );
}
function FieldInitializer({ world, editor }: { world: World; editor: EditorState }) {
  const layers = Object.values(world.layers).filter(
    (l) =>
      l.representation === "field" &&
      !world.fields.some((f) => f.layerId === l.id && f.areaId === editor.area.id)
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const layerId = String(form.get("layerId"));
        editor.execute("createField", {
          areaId: editor.area.id,
          layerId,
          resolution: Number(form.get("resolution")),
          value: Number(form.get("value")),
        });
        editor.setChannel(layerId);
      }}
    >
      <h3>Initialize a manual field</h3>
      <p className="hint">
        Create samples in this mapped area, then use the field brush to author local values.
      </p>
      <label>
        Field layer
        <select name="layerId" required>
          {layers.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Samples per axis
          <input name="resolution" type="number" min="2" defaultValue="48" required />
        </label>
        <label>
          Initial value
          <input name="value" type="number" step="any" defaultValue="0" required />
        </label>
      </div>
      <button className="secondary" disabled={!layers.length || editor.commit.isPending}>
        Create sampled field
      </button>
    </form>
  );
}

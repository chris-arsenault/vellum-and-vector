import type { EditorState } from "./useEditor";
import { FrameFields } from "./FormFields";

export function MagicForm({ editor }: { editor: EditorState }) {
  const origin = editor.area.frame.origin;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        editor.execute("putMagicSource", magicInput(form, editor));
      }}
    >
      <h3>Declare a magical force</h3>
      <p className="hint">
        Sources, propagation and retained effects participate in physical generation and epoch
        history.
      </p>
      <label>
        Name
        <input name="name" required placeholder="Geothermal heart" />
      </label>
      <FrameFields origin={origin} />
      <div className="form-row">
        <label>
          Radius · m
          <input name="radius" type="number" min="0.01" step="any" defaultValue="500" required />
        </label>
        <label>
          Strength
          <input name="strength" type="number" defaultValue="250" required />
        </label>
      </div>
      <label>
        Propagation
        <select name="propagation">
          <option value="radial">Radial decay</option>
          <option value="fracture">Through fractures</option>
          <option value="cold">Toward cold / stored in ice</option>
          <option value="ocean">Through ocean and bathymetry</option>
        </select>
      </label>
      <label>
        Environmental effect
        <select name="effect">
          <option value="heat">Heating</option>
          <option value="cold">Cooling</option>
          <option value="erosionResistance">Rock hardening</option>
          <option value="pressure">Coastal forcing</option>
          <option value="gravity">Gravity exception</option>
        </select>
      </label>
      <div className="form-row">
        <label>
          Decay
          <input name="decay" type="number" min="0" max="1" step="0.05" defaultValue="0.2" />
        </label>
        <label>
          Historical storage
          <input name="storage" type="number" min="0" max="1" step="0.05" defaultValue="0.3" />
        </label>
      </div>
      {editor.world.magic.length > 0 && (
        <label>
          Interacts with
          <select name="dependsOn" multiple>
            {editor.world.magic.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="primary">Save magical system</button>
    </form>
  );
}
function magicInput(form: FormData, editor: EditorState) {
  return {
    id: crypto.randomUUID(),
    name: String(form.get("name")),
    source: { x: Number(form.get("x")), y: Number(form.get("y")), z: Number(form.get("z")) },
    radius: Number(form.get("radius")),
    strength: Number(form.get("strength")),
    propagation: String(form.get("propagation")),
    effect: String(form.get("effect")),
    decay: Number(form.get("decay")),
    storage: Number(form.get("storage")),
    dependsOn: form.getAll("dependsOn").map(String),
    ...(editor.selection ? { scope: editor.selection } : {}),
  };
}

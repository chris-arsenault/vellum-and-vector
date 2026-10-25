import type { EditorState } from "./useEditor";
import type { CartographicPresentation } from "@atlas/domain";
import "./drawnMap.css";
import { DrawnFieldsPanel } from "./DrawnFieldsPanel";
import { CartographicFinishing } from "./CartographicFinishing";
import { ErrorMessage } from "./ErrorMessage";
import { DrawnSheetPanel } from "./DrawnSheetPanel";

export function CartographicPanel({ editor }: { editor: EditorState }) {
  const value = editor.cartography;
  const update = (change: Partial<CartographicPresentation>) => {
    editor.setCartography({ ...value, ...change });
  };
  return (
    <section className="cartographic-panel" aria-label="Cartographic presentation">
      <label>
        Presentation
        <select
          aria-label="Presentation"
          value={value.mode}
          onChange={(e) => update({ mode: e.target.value as typeof value.mode })}
        >
          <option value="raster">Raster investigation</option>
          <option value="drawn">Drawn map</option>
        </select>
      </label>
      {value.mode === "drawn" && <DrawnControls value={value} update={update} />}
      {value.mode === "drawn" && <DrawnFieldsPanel editor={editor} />}
      {value.mode === "drawn" && <CartographicFinishing editor={editor} />}
      {value.mode === "drawn" && <DrawnSheetPanel editor={editor} />}
      <ErrorMessage error={editor.commit.error} />
      <ErrorMessage error={editor.compositionError} />
    </section>
  );
}
function DrawnControls({
  value,
  update,
}: {
  value: CartographicPresentation;
  update: (change: Partial<CartographicPresentation>) => void;
}) {
  return (
    <>
      <label>
        Drawing style
        <select
          aria-label="Drawing style"
          value={value.style}
          onChange={(e) => update({ style: e.target.value as typeof value.style })}
        >
          <option value="wash">Ink and colour wash</option>
          <option value="ink">Monochrome ink</option>
        </select>
      </label>
      <label>
        Map subject
        <select
          aria-label="Map subject"
          value={value.subject}
          onChange={(e) => update({ subject: e.target.value as typeof value.subject })}
        >
          <option value="physical">Physical geography</option>
          <option value="political">Political atlas</option>
          <option value="cultural">Cultures and languages</option>
          <option value="infrastructure">Settlements and routes</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.terrain}
          onChange={(e) => update({ terrain: e.target.checked })}
        />{" "}
        Illustrated terrain
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.clip}
          onChange={(e) => update({ clip: e.target.checked })}
        />{" "}
        Clip to selected region
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.labels}
          onChange={(e) => update({ labels: e.target.checked })}
        />{" "}
        Map names
      </label>
      <label>
        Illustration density
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={value.density}
          onChange={(e) => update({ density: Number(e.target.value) })}
        />
      </label>
      <p className="hint">Draws the existing geography. Use Regions to choose the map subject.</p>
    </>
  );
}

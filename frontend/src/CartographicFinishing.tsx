import type { CartographicOverride, CartographicMark } from "@atlas/domain";
import type { EditorState } from "./useEditor";

export function CartographicFinishing({ editor }: { editor: EditorState }) {
  const feature = editor.selected;
  if (!feature)
    return <p className="hint">Select a feature to adjust its illustration or label.</p>;
  const own = editor.cartography.overrides[feature.id] ?? {};
  const update = (change: CartographicOverride) =>
    editor.finishCartography({
      ...editor.cartography,
      overrides: { ...editor.cartography.overrides, [feature.id]: { ...own, ...change } },
    });
  return (
    <section className="cartographic-finishing" aria-label="Feature map appearance">
      <h3>Label and symbol</h3>
      <label>
        <input
          type="checkbox"
          checked={own.illustrationHidden ?? false}
          onChange={(e) => update({ illustrationHidden: e.target.checked })}
        />{" "}
        Suppress illustration
      </label>
      <label>
        <input
          type="checkbox"
          checked={own.labelHidden ?? false}
          onChange={(e) => update({ labelHidden: e.target.checked })}
        />{" "}
        Hide label
      </label>
      {feature.geometry.type.includes("Point") && <PointSymbol own={own} update={update} />}
      <LabelNumbers own={own} update={update} />
      {own.path && <p className="hint">Label follows an authored curve.</p>}
      {own.anchor && <p className="hint">Label position is set on this map.</p>}
      <div className="drawn-actions">
        <button
          aria-pressed={editor.tool === "labelPlace"}
          onClick={() => editor.setTool("labelPlace")}
        >
          Place label on map
        </button>
        <button
          aria-pressed={editor.tool === "labelPath"}
          onClick={() => editor.setTool("labelPath")}
        >
          Draw label curve
        </button>
        <button
          onClick={() => {
            const overrides = { ...editor.cartography.overrides };
            delete overrides[feature.id];
            editor.finishCartography({ ...editor.cartography, overrides });
          }}
        >
          Reset feature drawing
        </button>
      </div>
      <p className="hint">
        Finishing changes this composition. Geographic position and source data stay unchanged. Undo
        reverses a finishing edit.
      </p>
    </section>
  );
}
function PointSymbol({
  own,
  update,
}: {
  own: CartographicOverride;
  update: (change: CartographicOverride) => void;
}) {
  return (
    <label>
      Feature symbol
      <select
        aria-label="Feature symbol"
        value={own.symbol ?? "auto"}
        onChange={(e) => update({ symbol: e.target.value as CartographicMark })}
      >
        {["auto", "town", "castle", "ruin", "tree", "mountain"].map((symbol) => (
          <option key={symbol}>{symbol}</option>
        ))}
      </select>
    </label>
  );
}
function LabelNumbers({
  own,
  update,
}: {
  own: CartographicOverride;
  update: (change: CartographicOverride) => void;
}) {
  const fields = [
    ["offsetX", "Label horizontal offset · px", 0],
    ["offsetY", "Label vertical offset · px", 0],
    ["rotation", "Label rotation · radians", 0],
    ["size", "Label size · px", 14],
  ] as const;
  return (
    <div className="drawn-label-numbers">
      {fields.map(([key, label, fallback]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            value={own[key] ?? fallback}
            min={key === "size" ? 1 : undefined}
            step={key === "rotation" ? 0.1 : 1}
            onChange={(e) => {
              if (e.target.value) update({ [key]: Number(e.target.value) });
            }}
          />
        </label>
      ))}
    </div>
  );
}

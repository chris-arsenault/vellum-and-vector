import type { EditorState } from "./useEditor";
import { fieldLabel } from "./rasterPresentation";
import { socialFieldChannel } from "./drawnFields";

export function DrawnFieldsPanel({ editor }: { editor: EditorState }) {
  const fields = [
    ...new Set(
      editor.raster.data?.map((r) => r.channel).filter((c) => socialFieldChannel.test(c)) ?? []
    ),
  ];
  const selected = editor.cartography.fields;
  return (
    <details className="drawn-fields">
      <summary>Social distributions</summary>
      <p className="hint">
        Each field is independent. Hatch length shows prevalence; population uses proportional dots.
      </p>
      {!fields.length && <p className="hint">No social distribution fields on this source map.</p>}
      {fields.map((channel) => (
        <label key={channel}>
          <input
            type="checkbox"
            checked={selected.includes(channel)}
            onChange={(e) =>
              editor.setCartography({
                ...editor.cartography,
                fields: e.target.checked
                  ? [...selected, channel]
                  : selected.filter((c) => c !== channel),
              })
            }
          />
          {fieldLabel(editor.world, channel)}
        </label>
      ))}
    </details>
  );
}

import type { EditorState } from "./useEditor";

export function FeatureDrawOrder({ editor, layerId }: { editor: EditorState; layerId: string }) {
  const at = editor.styles.findIndex((s) => s.layerId === layerId);
  return (
    <label>
      Draw order
      <select
        aria-label="Draw order"
        value={editor.styles[at + 1]?.layerId ?? "bottom"}
        onChange={(event) => {
          const selected = editor.styles[at],
            next = editor.styles.filter((s) => s.layerId !== layerId);
          const target =
            event.target.value === "bottom"
              ? next.length
              : next.findIndex((s) => s.layerId === event.target.value);
          next.splice(target, 0, selected);
          editor.setStyles(next);
        }}
      >
        {editor.styles
          .filter((s) => s.layerId !== layerId)
          .map((s) => (
            <option key={s.layerId} value={s.layerId}>
              Above {editor.world.layers[s.layerId].name}
            </option>
          ))}
        <option value="bottom">Below all feature layers</option>
      </select>
    </label>
  );
}

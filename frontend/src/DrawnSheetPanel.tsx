import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { EditorState } from "./useEditor";
import type { DrawnMapInput } from "./drawnMap";
import { downloadDrawnSheet } from "./drawnExport";
import { ErrorMessage } from "./ErrorMessage";

export function DrawnSheetPanel({ editor }: { editor: EditorState }) {
  const [width, setWidth] = useState(2400),
    [height, setHeight] = useState(1800);
  const sheet = editor.cartography.sheet;
  const update = (change: Partial<typeof sheet>) =>
    editor.setCartography({ ...editor.cartography, sheet: { ...sheet, ...change } });
  const exportSheet = useMutation({
    mutationFn: async () => {
      const input = editor.mapEngine?.drawn.get("input") as DrawnMapInput | undefined;
      if (!input) throw new Error("Open a drawn map before exporting a sheet.");
      await downloadDrawnSheet(input, width, height);
    },
  });
  return (
    <details className="drawn-sheet-panel">
      <summary>Finished sheet</summary>
      <label>
        Sheet title
        <input
          value={sheet.title}
          placeholder={editor.region?.name ?? editor.area.name}
          onChange={(e) => update({ title: e.target.value })}
        />
      </label>
      <label>
        Sheet subtitle
        <input
          value={sheet.subtitle}
          placeholder="Region ancestry"
          onChange={(e) => update({ subtitle: e.target.value })}
        />
      </label>
      {(["frame", "legend", "compass", "scale"] as const).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={sheet[key]}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
          {`Sheet ${key}`}
        </label>
      ))}
      <div className="drawn-label-numbers">
        <label>
          Image width · px
          <input
            type="number"
            min="1"
            step="1"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          Image height · px
          <input
            type="number"
            min="1"
            step="1"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
      </div>
      <button disabled={exportSheet.isPending} onClick={() => exportSheet.mutate()}>
        {exportSheet.isPending ? "Drawing sheet…" : "Download map PNG"}
      </button>
      <ErrorMessage error={exportSheet.error} />
    </details>
  );
}

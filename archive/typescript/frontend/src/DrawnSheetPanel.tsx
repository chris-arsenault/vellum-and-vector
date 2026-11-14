import type { EditorState } from "./useEditor";
import type { DrawnMapInput } from "./drawnMap";
import { downloadDrawnSheet } from "./drawnExport";
import { SheetControls } from "./SheetControls";

export function DrawnSheetPanel({ editor }: { editor: EditorState }) {
  return (
    <SheetControls
      name={editor.region?.name ?? editor.area.name}
      sheet={editor.cartography.sheet}
      update={(change) =>
        editor.setCartography({
          ...editor.cartography,
          sheet: { ...editor.cartography.sheet, ...change },
        })
      }
      download={async (width, height) => {
        const input = editor.mapEngine?.drawn.get("input") as DrawnMapInput | undefined;
        if (!input) throw new Error("Open a drawn map before exporting a sheet.");
        await downloadDrawnSheet(input, width, height);
      }}
    />
  );
}

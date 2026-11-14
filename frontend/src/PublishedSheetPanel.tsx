import { SheetControls } from "./SheetControls";
import { downloadPublishedSheet } from "./publishedSheetExport";
import type { PublishedStyleContext } from "./publishedStyling";

export function PublishedSheetPanel({ map, reader, value, change }: PublishedStyleContext) {
  return (
    <SheetControls
      name={map.name}
      sheet={value.drawing.sheet}
      update={(changes) =>
        change({
          ...value,
          drawing: { ...value.drawing, sheet: { ...value.drawing.sheet, ...changes } },
        })
      }
      download={(width, height) => downloadPublishedSheet(map, reader, value, width, height)}
    />
  );
}

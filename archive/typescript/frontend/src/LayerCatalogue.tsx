import { fieldChannelName } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { fieldLabel } from "./rasterPresentation";
import { commonOverlay, overlayTheme, overlayBranch } from "./overlayFields";
import { shownUnit } from "./fieldNames";
import { OverlayCatalogue } from "./OverlayCatalogue";

export function LayerCatalogue({
  id,
  editor,
  update,
  remove,
}: {
  id: string;
  editor: EditorState;
  update(channel: string, changes: Partial<FieldStyle>): void;
  remove(channel: string): void;
}) {
  const data = editor.raster.data ?? [];
  const choices = [...new Set(data.map((raster) => raster.channel))].map((id) => ({
    id,
    name: fieldLabel(editor.world, id),
    theme: overlayTheme(id),
    branch: overlayBranch(editor.world, id),
    common: commonOverlay(id),
    unit: shownUnit(
      data.find((raster) => raster.channel === id)!.field.units[fieldChannelName(id)] ?? ""
    ).unit,
  }));
  return (
    <OverlayCatalogue
      id={id}
      fields={editor.rasterView.fields}
      choices={choices}
      update={update}
      remove={remove}
    />
  );
}

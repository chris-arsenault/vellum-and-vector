import type { EditorState } from "./useEditor";
import { OverlayStackControls, type StackProps } from "./OverlayStackControls";
import { rasterDescription } from "./worldRasterDescription";
export type { OverlayActions } from "./OverlayStackControls";

export function OverlayStack({
  editor,
  ...props
}: Omit<StackProps, "descriptions"> & { editor: EditorState }) {
  const descriptions = props.fields.map((field) =>
    rasterDescription(
      editor.world,
      field.channel,
      (editor.raster.data ?? []).filter((raster) => raster.channel === field.channel)
    )
  );
  return <OverlayStackControls {...props} descriptions={descriptions} />;
}

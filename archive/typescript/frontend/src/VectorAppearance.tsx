import type { EditorState } from "./useEditor";
import type { LayerStyle } from "./types";
import { useLayerPresentation } from "./useWorkspacePresentation";
import { VectorAppearanceControls } from "./VectorAppearanceControls";

export function VectorAppearance({
  editor,
  presentation,
  advanced,
}: {
  editor: EditorState;
  presentation: LayerStyle;
  advanced(): void;
}) {
  const data = useLayerPresentation(editor.world, presentation.layerId);
  const layer = editor.world.layers[presentation.layerId];
  const kinds = data.data?.geometries ?? [];
  return (
    <VectorAppearanceControls
      name={layer.name}
      presentation={presentation}
      kinds={kinds.length ? kinds : layer.representation === "network" ? ["LineString"] : []}
      mode={editor.cartography.mode}
      advanced={advanced}
      update={(changes) =>
        editor.setStyles(
          editor.styles.map((style) =>
            style.layerId === presentation.layerId ? { ...style, ...changes } : style
          )
        )
      }
    />
  );
}

import { availableFeatureTypes, describeFeature } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import { FeatureThemeControls } from "./FeatureThemeControls";

/** Adapter retained with the deferred editor; finished maps supply their own catalogue. */
export function FeatureThemes({
  editor,
  edit,
}: {
  editor: EditorState;
  edit(target: string): void;
}) {
  const features = editor.scene.data ?? [];
  const allTypes = availableFeatureTypes(editor.world, features, true).map((type) => {
    const members = features.filter(
      (feature) => describeFeature(editor.world, feature).id === type.id
    );
    return {
      ...type,
      count: members.length,
      geometries: [...new Set(members.map((feature) => feature.geometry.type))],
      footprints: members.some((feature) => !!feature.footprint),
    };
  });
  return (
    <FeatureThemeControls
      allTypes={allTypes}
      styles={editor.styles}
      setStyles={editor.setStyles}
      edit={edit}
      layerName={(id) => editor.world.layers[id].name}
    />
  );
}

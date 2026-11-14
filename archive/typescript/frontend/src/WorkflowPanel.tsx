import type { ComponentType } from "react";
import { AdvancedPanel } from "./AdvancedPanel";
import { CartographyPanel } from "./CartographyPanel";
import { DevelopmentPanel } from "./DevelopmentPanel";
import { FeatureForm } from "./FeatureForm";
import { MagicForm } from "./MagicForm";
import { LandmarkForm } from "./LandmarkForm";
import { ReconcilePanel } from "./ReconcilePanel";
import { RefinementPanel } from "./RefinementPanel";
import { RegionalGeneration } from "./RegionalGeneration";
import { RegionsPanel } from "./RegionsPanel";
import type { EditorState } from "./useEditor";
import type { World } from "./types";

type PanelProps = { world: World; editor: EditorState };
const panels: Record<string, ComponentType<PanelProps>> = {
  regions: RegionsPanel,
  "configure-generation": RegionalGeneration,
  reconcile: ReconcilePanel,
  more: AdvancedPanel,
  refine: RefinementPanel,
  feature: FeatureForm,
  author: CartographyPanel,
  magic: MagicForm,
  landmark: LandmarkForm,
};

export function WorkflowPanel({ world, editor }: PanelProps) {
  const Panel = panels[editor.panel];
  if (Panel) return <Panel world={world} editor={editor} />;
  return editor.region ? (
    <RegionsPanel editor={editor} />
  ) : (
    <DevelopmentPanel key={editor.area.id} world={world} editor={editor} />
  );
}

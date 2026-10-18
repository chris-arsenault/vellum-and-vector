import { AdvancedPanel } from "./AdvancedPanel";
import { CartographyPanel } from "./CartographyPanel";
import { DevelopmentPanel } from "./DevelopmentPanel";
import { FeatureForm } from "./FeatureForm";
import { MagicForm } from "./MagicForm";
import { ReconcilePanel } from "./ReconcilePanel";
import { RefinementPanel } from "./RefinementPanel";
import type { EditorState } from "./useEditor";
import type { World } from "./types";

export function WorkflowPanel({ world, editor }: { world: World; editor: EditorState }) {
  switch (editor.panel) {
    case "reconcile":
      return <ReconcilePanel world={world} editor={editor} />;
    case "more":
      return <AdvancedPanel world={world} editor={editor} />;
    case "refine":
      return <RefinementPanel world={world} editor={editor} />;
    case "feature":
      return <FeatureForm world={world} editor={editor} />;
    case "author":
      return <CartographyPanel world={world} editor={editor} />;
    case "magic":
      return <MagicForm editor={editor} />;
    default:
      return <DevelopmentPanel world={world} editor={editor} />;
  }
}

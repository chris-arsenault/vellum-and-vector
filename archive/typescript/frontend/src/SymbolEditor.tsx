import type { Style as SymbolStyle } from "geostyler-style";
import type { LayerStyle, World } from "./types";
import { useLayerPresentation } from "./useWorkspacePresentation";
import SymbolEditorForm from "./SymbolEditorForm";

export default function SymbolEditor(props: {
  world: World;
  presentation: LayerStyle;
  apply(symbols: SymbolStyle | undefined): void;
  close(): void;
}) {
  const data = useLayerPresentation(props.world, props.presentation.layerId);
  if (data.isPending) return <p role="status">Reading layer attributes…</p>;
  if (data.error) return <p role="alert">{data.error.message}</p>;
  return (
    <SymbolEditorForm
      name={props.world.layers[props.presentation.layerId].name}
      presentation={props.presentation}
      data={data.data}
      apply={props.apply}
      close={props.close}
    />
  );
}

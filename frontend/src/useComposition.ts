import { useRef, useState, type SetStateAction } from "react";
import { defaultCartographicPresentation, type CartographicPresentation } from "@atlas/domain";
import type { LayerStyle, RasterPresentation, World } from "./types";
import { makeCommand, useCommit } from "./useAtlas";
import { defaultDrawnStyles } from "./drawnStyles";
import { defaultStyles } from "./presentation";
import { initialSubjectFields } from "./drawnFields";

const legacyPresentation = defaultCartographicPresentation();

interface Scope {
  areaId: string;
  selectedRegionId: string | null;
  savedStyles: LayerStyle[];
  rasterView: RasterPresentation;
  setStyles: (styles: LayerStyle[]) => void;
}
/** Saved compositions use the same commands, history and local save as region subjects. */
export function useComposition(world: World, scope: Scope) {
  const [id, setCompositionId] = useState<string | null>(null);
  const [draft, setDraft] = useState(defaultCartographicPresentation);
  const commit = useCommit(world.id);
  const rasterStyles = useRef<LayerStyle[] | null>(null);
  const current = world.views.find(
    (v) =>
      v.id === id && v.areaId === scope.areaId && (v.regionId ?? null) === scope.selectedRegionId
  );
  const cartography = current ? (current.cartography ?? legacyPresentation) : draft;
  const layers = current?.layers ?? scope.savedStyles;
  const styleChange = (value: CartographicPresentation) =>
    changedStyles(value, cartography, world, layers, rasterStyles);
  const save = (name: string, value = cartography, copy = false) => {
    const viewId = copy ? crypto.randomUUID() : (current?.id ?? crypto.randomUUID());
    commit.mutate(
      makeCommand(world, "putView", {
        id: viewId,
        name,
        areaId: scope.areaId,
        layers: styleChange(value),
        raster: scope.rasterView,
        ...(scope.selectedRegionId ? { regionId: scope.selectedRegionId } : {}),
        cartography: value,
      }),
      { onSuccess: () => setCompositionId(viewId) }
    );
  };
  return {
    cartography,
    compositionId: current?.id ?? null,
    compositionName: current?.name ?? "Custom composition",
    compositionLayers: current?.layers,
    compositionError: commit.error,
    setCompositionId,
    openComposition: (view: World["views"][number]) => {
      scope.setStyles(view.layers);
      setCompositionId(view.id);
    },
    setStyles: (value: SetStateAction<LayerStyle[]>) => {
      const next = typeof value === "function" ? value(layers) : value;
      scope.setStyles(next);
      if (current) commit.mutate(makeCommand(world, "putView", { ...current, layers: next }));
    },
    setCartography: (value: CartographicPresentation) => {
      const next =
        value.subject !== cartography.subject
          ? initialSubjectFields(value, world, scope.areaId)
          : value;
      scope.setStyles(styleChange(next));
      if (current) save(current.name, next);
      else setDraft(next);
    },
    finishCartography: (value: CartographicPresentation) =>
      save(current?.name ?? "Drawn map", value),
    saveComposition: (name: string) => save(name, cartography, true),
  };
}
function changedStyles(
  value: CartographicPresentation,
  previous: CartographicPresentation,
  world: World,
  layers: LayerStyle[],
  rasterStyles: { current: LayerStyle[] | null }
) {
  if (value.mode === "drawn" && previous.mode === "raster") rasterStyles.current = layers;
  if (value.mode === "raster" && previous.mode === "drawn")
    return rasterStyles.current ?? defaultStyles(world);
  if (value.mode === "drawn" && (previous.mode !== "drawn" || value.subject !== previous.subject))
    return defaultDrawnStyles(world, value.subject);
  return layers;
}

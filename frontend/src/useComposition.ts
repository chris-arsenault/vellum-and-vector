import { useRef, useState, type SetStateAction } from "react";
import {
  defaultCartographicPresentation,
  regionSourceAreaId,
  type CartographicPresentation,
} from "@atlas/domain";
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
function useCompositionState(world: World, scope: Scope) {
  const [id, setCompositionId] = useState<string | null>(null);
  const [draft, setDraft] = useState(defaultCartographicPresentation);
  const [pending, setPending] = useState<{
    id: string;
    cartography: CartographicPresentation;
    layers: LayerStyle[];
  } | null>(null);
  const sourceAreaId = regionSourceAreaId(world, scope.selectedRegionId, scope.areaId);
  const current = world.views.find(
    (v) =>
      v.id === id && v.areaId === sourceAreaId && (v.regionId ?? null) === scope.selectedRegionId
  );
  const editing = pending?.id === current?.id ? pending : null;
  const cartography = editing?.cartography ?? currentPresentation(current, draft);
  const layers = editing?.layers ?? current?.layers ?? scope.savedStyles;
  return {
    current,
    editing,
    cartography,
    layers,
    sourceAreaId,
    setDraft,
    setPending,
    setCompositionId,
  };
}
function currentPresentation(
  current: World["views"][number] | undefined,
  draft: CartographicPresentation
) {
  return current ? (current.cartography ?? legacyPresentation) : draft;
}
export function useComposition(world: World, scope: Scope) {
  const {
    current,
    editing,
    cartography,
    layers,
    sourceAreaId,
    setDraft,
    setPending,
    setCompositionId,
  } = useCompositionState(world, scope);
  const commit = useCommit(world.id);
  const rasterStyles = useRef<LayerStyle[] | null>(null);
  const styleChange = (value: CartographicPresentation) =>
    changedStyles(value, cartography, world, layers, rasterStyles);
  const save = (name: string, value = cartography, copy = false) => {
    const viewId = copy ? crypto.randomUUID() : (current?.id ?? crypto.randomUUID());
    const nextLayers = styleChange(value);
    setDraft(value);
    setPending({ id: viewId, cartography: value, layers: nextLayers });
    commit.mutate(
      makeCommand(world, "putView", {
        id: viewId,
        name,
        areaId: sourceAreaId,
        layers: nextLayers,
        raster: scope.rasterView,
        ...(scope.selectedRegionId ? { regionId: scope.selectedRegionId } : {}),
        cartography: value,
      }),
      {
        onSuccess: () => {
          setCompositionId(viewId);
          setPending(null);
        },
        onError: () => setPending(null),
      }
    );
  };
  return {
    cartography,
    compositionId: current?.id ?? null,
    compositionName: current?.name ?? "Custom composition",
    compositionLayers: editing?.layers ?? current?.layers,
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

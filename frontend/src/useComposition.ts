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
import { readEditorWorld } from "./atlasWorkspace";

const legacyPresentation = defaultCartographicPresentation();
type CompositionDraft = World["views"][number] & { cartography: CartographicPresentation };

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
  const [pending, setPending] = useState<CompositionDraft | null>(null);
  const sourceAreaId = regionSourceAreaId(world, scope.selectedRegionId, scope.areaId);
  const current = world.views.find((v) =>
    matchesComposition(v, id, sourceAreaId, scope.selectedRegionId)
  );
  const editing = matchesComposition(pending, id, sourceAreaId, scope.selectedRegionId)
    ? pending
    : null;
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
function matchesComposition(
  view: World["views"][number] | null,
  id: string | null,
  areaId: string,
  regionId: string | null
) {
  return view?.id === id && view.areaId === areaId && (view.regionId ?? null) === regionId;
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
  const view = editing ?? current;
  const commit = useCommit(world.id, `composition:${world.id}`);
  const rasterStyles = useRef<LayerStyle[] | null>(null);
  const styleChange = (value: CartographicPresentation) =>
    changedStyles(value, cartography, world, layers, rasterStyles);
  const write = (view: CompositionDraft) => {
    setDraft(view.cartography);
    setCompositionId(view.id);
    setPending(view);
    const settled = () => setPending((pending) => (pending === view ? null : pending));
    commit.mutate(
      // Prepare the revision when this serialized save runs, after earlier saves commit.
      async () => makeCommand(await readEditorWorld(world.id), "putView", { ...view }),
      { onSuccess: settled, onError: settled }
    );
  };
  const save = (name: string, value = cartography, copy = false) => {
    write({
      id: copy ? crypto.randomUUID() : (view?.id ?? crypto.randomUUID()),
      name,
      areaId: sourceAreaId,
      layers: styleChange(value),
      raster: scope.rasterView,
      ...(scope.selectedRegionId ? { regionId: scope.selectedRegionId } : {}),
      cartography: value,
    });
  };
  return {
    cartography,
    compositionId: view?.id ?? null,
    compositionName: view?.name ?? "Custom composition",
    compositionLayers: view?.layers,
    compositionError: commit.error,
    setCompositionId,
    openComposition: (view: World["views"][number]) => {
      scope.setStyles(view.layers);
      setCompositionId(view.id);
    },
    setStyles: (value: SetStateAction<LayerStyle[]>) => {
      const next = typeof value === "function" ? value(layers) : value;
      scope.setStyles(next);
      if (view) write({ ...view, layers: next, cartography });
    },
    setCartography: (value: CartographicPresentation) => {
      const next =
        value.subject !== cartography.subject
          ? initialSubjectFields(value, world, scope.areaId)
          : value;
      scope.setStyles(styleChange(next));
      if (view) save(view.name, next);
      else setDraft(next);
    },
    finishCartography: (value: CartographicPresentation) => save(view?.name ?? "Drawn map", value),
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

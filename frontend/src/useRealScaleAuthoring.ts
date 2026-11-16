import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EditCommand, EditOutcome, MapDescriptor, MapEditing, MapLayer } from "@atlas/map";
import { vectorFamily } from "./publishedAppearance";

/** Select moves, turns and sizes the selection; points edits its vertices; draw adds shapes. */
export type EditTool = "select" | "points" | "draw";
export type DrawShape = "line" | "area";
export interface DrawChoice {
  layerId: string;
  kind: string;
  name: string;
  /** Width given to each point of a drawn line, in metres. */
  width: number;
}
export interface AuthoringState {
  tool: EditTool;
  draw: DrawChoice | null;
  keepTool: boolean;
  snapHexes: boolean;
  selected: string[];
  /** The creator layer new shapes go into. */
  target: string;
  styleSource: string | null;
}
export type AuthoringSession = ReturnType<typeof useRealScaleAuthoring>;

/** Layer families a creator draws into and the shape their features take. */
const lineFamilies = new Set(["rivers", "roads", "waterworks"]);
const areaFamilies = new Set(["lakes", "oceans", "plots", "structures", "ruins", "objects"]);
export function drawShape(layerId: string): DrawShape | null {
  const family = vectorFamily(layerId);
  if (lineFamilies.has(family)) return "line";
  return areaFamilies.has(family) ? "area" : null;
}
export const authorableLayers = (map: MapDescriptor): MapLayer[] =>
  map.layers.filter((layer) => layer.source.kind === "vector" && drawShape(layer.id));
/** The first drawable kind, so the Draw tool always has a choice. */
export function defaultDraw(map: MapDescriptor): DrawChoice | null {
  const layer = authorableLayers(map).find((entry) => entry.catalog.featureTypes.length);
  const kind = layer?.catalog.featureTypes[0]?.kind;
  return layer && kind ? { layerId: layer.id, kind, name: "", width: 1 } : null;
}

/** The edit session of one open real-scale map; every change runs in the Rust map store. */
export function useRealScaleAuthoring(map: MapDescriptor, editing: MapEditing) {
  const cache = useQueryClient();
  const reference = map.reference;
  const [state, setState] = useState<AuthoringState>(() => ({
    tool: "select",
    draw: null,
    keepTool: false,
    snapHexes: false,
    selected: [],
    target: map.realScale?.creatorLayers[0]?.id ?? "",
    styleSource: null,
  }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const history = useQuery({
    queryKey: ["edit-history", reference],
    enabled: !!map.realScale,
    queryFn: ({ signal }) => editing.history(reference, { signal }),
  });
  const set = useCallback(
    (next: Partial<AuthoringState>) => setState((value) => ({ ...value, ...next })),
    []
  );
  const settle = useCallback(
    (outcome: EditOutcome) => {
      cache.setQueryData(["finished-map", outcome.map.reference], outcome.map);
      cache.setQueryData(["edit-history", outcome.map.reference], outcome.history);
      void cache.invalidateQueries({ queryKey: ["edited-features", outcome.map.reference] });
      setError(null);
      return outcome;
    },
    [cache]
  );
  const perform = useCallback(
    async (work: () => Promise<EditOutcome>) => {
      setBusy(true);
      try {
        return settle(await work());
      } catch (failure) {
        setError(failure);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [settle]
  );
  const run = useCallback(
    (command: EditCommand) => perform(() => editing.edit(reference, command)),
    [perform, editing, reference]
  );
  const undo = useCallback(
    () => perform(() => editing.undo(reference)),
    [perform, editing, reference]
  );
  const redo = useCallback(
    () => perform(() => editing.redo(reference)),
    [perform, editing, reference]
  );
  const steps = useMemo(() => history.data?.steps ?? [], [history.data]);
  return {
    map,
    state,
    set,
    run,
    undo,
    redo,
    steps,
    canUndo: steps.some((step) => !step.undone),
    canRedo: steps.some((step) => step.undone),
    error: error ?? history.error,
    busy,
  };
}

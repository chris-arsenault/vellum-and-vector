import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EditCommand,
  EditOutcome,
  JsonValue,
  MapDescriptor,
  MapEditing,
  MapLayer,
} from "@atlas/map";
import { vectorFamily } from "./publishedAppearance";
import { defaultLand, type LandChoice } from "./realScaleLandTools";
import { defaultTown, type TownChoice, type ViewFocus } from "./realScaleTown";

/** Select moves, turns and sizes the selection; points edits its vertices; draw adds shapes;
 * place sets down one object, scatter fills an outline with them, hexes selects hexes;
 * street draws a town street and building places a building on a plot. */
export type EditTool =
  "select" | "points" | "draw" | "place" | "scatter" | "hexes" | "street" | "building";
export type DrawShape = "line" | "area";
export interface DrawChoice {
  layerId: string;
  kind: string;
  name: string;
  /** Width given to each point of a drawn line, in metres. */
  width: number;
  /** Kind attributes every drawn shape takes, such as a way's class. */
  attributes?: Record<string, JsonValue>;
}
export interface AuthoringState {
  tool: EditTool;
  draw: DrawChoice | null;
  land: LandChoice;
  town: TownChoice;
  /** Where the view centres next, as for a building found by its address. */
  focus: ViewFocus | null;
  keepTool: boolean;
  snapHexes: boolean;
  selected: string[];
  /** The creator layer new shapes go into. */
  target: string;
  styleSource: string | null;
}
export type AuthoringSession = ReturnType<typeof useRealScaleAuthoring>;

/** Layer families a creator draws into and the shape their features take. */
const lineFamilies = new Set(["rivers", "roads", "waterworks", "caveWalls"]);
const areaFamilies = new Set(["lakes", "oceans", "plots", "structures", "ruins", "objects"]);
export function drawShape(layerId: string, kind?: string): DrawShape | null {
  const family = vectorFamily(layerId);
  // A wall is a line with a thickness, even among the structures layer's outlines (Rust
  // `shape_of_kind`).
  if (family === "structures" && kind === "wall") return "line";
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

const initialState = (map: MapDescriptor): AuthoringState => ({
  tool: "select",
  draw: null,
  land: defaultLand(),
  town: defaultTown(),
  focus: null,
  keepTool: false,
  snapHexes: false,
  selected: [],
  target: map.realScale?.creatorLayers[0]?.id ?? "",
  styleSource: null,
});
/** The edit session of one open real-scale map; every change runs in the Rust map store. */
export function useRealScaleAuthoring(
  map: MapDescriptor,
  editing: MapEditing,
  /** Shows a located space, such as the Caves level a first cave wall opens. */
  showSpace: (spaceId: string) => void = () => {}
) {
  const cache = useQueryClient();
  const reference = map.reference;
  const [state, setState] = useState<AuthoringState>(() => initialState(map));
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
    showSpace,
  };
}

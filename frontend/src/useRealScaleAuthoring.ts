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
import { defaultAuthored, type AuthoredChoice } from "./authoredState";
import { useAuthoredActions } from "./useAuthoredActions";

/** Select moves, turns and sizes the selection; points edits its vertices; draw adds shapes;
 * place sets down one object, scatter fills an outline with them, hexes selects hexes;
 * street draws a town street and building places a building on a plot. On authored maps,
 * brush, heightLine, heightArea and peak shape the terrain (ADR 0019). */
export type EditTool =
  | "select"
  | "points"
  | "draw"
  | "place"
  | "scatter"
  | "hexes"
  | "street"
  | "building"
  | "brush"
  | "heightLine"
  | "heightArea"
  | "peak";
export type DrawShape = "line" | "area";
export interface DrawChoice {
  layerId: string;
  kind: string;
  name: string;
  /** Width given to each point of a drawn line, in metres. */
  width: number;
  /** Kind attributes every drawn shape takes, such as a way's class. */
  attributes?: Record<string, JsonValue>;
  /** The geometry to draw on an authored map, where any kind may be a point, line or area. */
  geometry?: "Point" | "LineString" | "Polygon";
}
export interface AuthoringState {
  tool: EditTool;
  /** Authored maps only: the toolbar's tool and its brush and height settings. */
  authored: AuthoredChoice;
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
const hexFamilies = new Set(["hexes", "caveHexes"]);
/** Authored maps draw into every vector layer except hexes; the kind's suggested geometry
 * (the draw choice's `geometry`) decides the actual shape. */
export const isAuthored = (map: MapDescriptor) => map.realScale?.kind === "authored";
export function drawShape(layerId: string, kind?: string, authored = false): DrawShape | null {
  const family = vectorFamily(layerId);
  if (authored) return hexFamilies.has(family) ? null : lineFamilies.has(family) ? "line" : "area";
  // A wall is a line with a thickness, even among the structures layer's outlines (Rust
  // `shape_of_kind`).
  if (family === "structures" && kind === "wall") return "line";
  if (lineFamilies.has(family)) return "line";
  return areaFamilies.has(family) ? "area" : null;
}
export const authorableLayers = (map: MapDescriptor): MapLayer[] =>
  map.layers.filter(
    (layer) => layer.source.kind === "vector" && drawShape(layer.id, undefined, isAuthored(map))
  );
/** The first drawable kind, so the Draw tool always has a choice. */
export function defaultDraw(map: MapDescriptor): DrawChoice | null {
  const layer = authorableLayers(map).find((entry) => entry.catalog.featureTypes.length);
  const kind = layer?.catalog.featureTypes[0]?.kind;
  return layer && kind ? { layerId: layer.id, kind, name: "", width: 1 } : null;
}

const initialState = (map: MapDescriptor): AuthoringState => ({
  tool: "select",
  authored: defaultAuthored(map.bounds),
  draw: null,
  land: defaultLand(),
  town: defaultTown(),
  focus: null,
  // An authored map keeps the tool: a creator draws many coasts and places many things.
  keepTool: isAuthored(map),
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
  const guard = useCallback(async <T>(work: () => Promise<T>) => {
    setBusy(true);
    try {
      const done = await work();
      setError(null);
      return done;
    } catch (failure) {
      setError(failure);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const perform = useCallback(
    (work: () => Promise<EditOutcome>) => guard(async () => settle(await work())),
    [guard, settle]
  );
  const run = useCallback(
    (command: EditCommand) => perform(() => editing.edit(reference, command)),
    [perform, editing, reference]
  );
  const steps = useMemo(() => history.data?.steps ?? [], [history.data]);
  const authored = useAuthoredActions({ map, editing, perform, guard, steps });
  // An authored map's Undo and Redo reach feature and terrain edits alike; a real-scale
  // map has feature edits only.
  const own = isAuthored(map)
    ? authored
    : {
        ...authored,
        run,
        undo: () => perform(() => editing.undo(reference)),
        redo: () => perform(() => editing.redo(reference)),
        canUndo: steps.some((step) => !step.undone),
        canRedo: steps.some((step) => step.undone),
      };
  return {
    ...{ map, state, set, steps, showSpace, busy },
    ...own,
    error: error ?? history.error,
  };
}

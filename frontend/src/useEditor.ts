import { useState, useMemo } from "react";
import { bounds, defaultStyles, frameAt } from "./presentation";
import { makeCommand, useCommit } from "./useAtlas";
import type { Area, AtlasFeature, LayerStyle, Tool, World } from "./types";
import type { Geometry } from "geojson";
import { useMapData } from "./useScene";
import { editArea, scopedFootprint } from "./useScene";
import { useCartographicState } from "./useCartographicState";
import { useMapActions } from "./useMapActions";
import type { MapEngine } from "./mapEngine";
import { defaultRasterPresentation, defaultFieldStyle } from "./rasterPresentation";
import { useRegions, isRegionTool } from "./useRegions";
import { useComposition } from "./useComposition";
import { useQuery } from "@tanstack/react-query";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";
import type { CartographicPresentation } from "@atlas/domain";

function useEditorState(world: World) {
  const [selectedAreaId, setAreaId] = useState(
    Object.values(world.areas).find((a) => !a.parentId)!.id
  );
  const area = world.areas[selectedAreaId] ?? Object.values(world.areas).find((a) => !a.parentId)!;
  const areaId = area.id;
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<AtlasFeature | null>(null);
  const [selectedRegionId, setRegionId] = useState<string | null>(null);
  const [savedStyles, setStyles] = useState<LayerStyle[]>(() => defaultStyles(world));
  const [selection, setSelection] = useState<Geometry | null>(null);
  const [drawing, setDrawing] = useState<Geometry | null>(null);
  const [channel, setBrushChannel] = useState("elevation");
  const [rasterView, setRasterView] = useState(defaultRasterPresentation);
  const [mapEngine, setMapEngine] = useState<MapEngine | null>(null);
  const [brush, setBrush] = useState(() => initialBrush(area));
  const [panel, setPanel] = useState("generate");
  const [proposedFeatures, setProposedFeatures] = useState<AtlasFeature[]>([]);
  const [pendingEdits, setPendingEdits] = useState<{ areaId: string; feature: AtlasFeature }[]>([]);
  const [pendingSculpt, setPendingSculpt] = useState<Record<string, unknown> | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [viewport, setViewport] = useState<number[] | null>(null);
  return {
    areaId,
    setAreaId,
    area,
    tool,
    setTool,
    selected,
    selectedRegionId,
    setRegionId,
    setSelected,
    savedStyles,
    setStyles,
    selection,
    setSelection,
    drawing,
    setDrawing,
    channel,
    setChannel: (channel: string) => {
      setBrushChannel(channel);
      if (channel !== "elevation")
        setRasterView((view) => ({
          ...view,
          fields: view.fields.some((field) => field.channel === channel)
            ? view.fields.map((field) =>
                field.channel === channel ? { ...field, visible: true } : field
              )
            : [...view.fields, defaultFieldStyle(channel)],
        }));
    },
    rasterView,
    setRasterView,
    mapEngine,
    setMapEngine,
    brush,
    setBrush,
    panel,
    setPanel,
    proposedFeatures,
    setProposedFeatures,
    pendingEdits,
    setPendingEdits,
    pendingSculpt,
    setPendingSculpt,
    reconciling,
    setReconciling,
    viewport,
    setViewport,
    ...useCartographicState(),
  };
}
function initialBrush(area: Area) {
  const extent = bounds(area.footprint);
  return {
    radius: (extent[2] - extent[0]) / 30,
    delta: 10,
    mode: "add" as "add" | "set" | "smooth",
  };
}
export function useEditor(world: World) {
  const session = useEditorState(world);
  const canonical = useSelectedFeature(world, session.areaId, session.selected);
  const state = { ...session, selected: canonical };
  const { area, savedStyles, viewport, setViewport, setChannel } = state;
  const composition = useComposition(world, state);
  const styledState = { ...state, setStyles: composition.setStyles };
  const editing = useEditing(world, styledState);
  const sourceStyles = composition.compositionLayers ?? savedStyles;
  const styles = useMemo(() => completeStyles(world, sourceStyles), [world, sourceStyles]);
  const actions = useMapActions(world, styledState, editing);
  const regions = useRegions({ ...state, world, commit: editing.commit });
  return {
    ...state,
    ...editing,
    world,
    styles,
    viewportExtent: viewport,
    ...useMapData(
      world,
      area.id,
      mapDataExtent(composition.cartography, regions.regionPresentation, area, viewport),
      state.mapEngine?.map.getView().getResolution()
    ),
    viewport: setViewport,
    ...actions,
    ...regions,
    ...composition,
    enter: (id: string) => {
      regions.cancelRegion();
      actions.enter(id);
    },
    draw: (geometry: Geometry) =>
      isRegionTool(state.tool)
        ? regions.regionDraw(geometry)
        : state.tool.startsWith("label")
          ? finishLabel(state, composition, geometry)
          : actions.draw(geometry),
    selectExtent: (geometry: Geometry) => {
      if (
        state.selected?.kind === "building" ||
        ["refine", "refinePolygon", "extentEdit"].includes(state.tool)
      ) {
        actions.selectExtent(geometry);
        return;
      }
      state.setPanel("regions");
      regions.regionDraw(geometry);
    },
    cancel: () => (isRegionTool(state.tool) ? regions.cancelRegion() : actions.cancel()),
    preset: (name: string) => {
      composition.setStyles(defaultStyles(world, name));
      setChannel(presetChannel(world, name));
      const selected = presetChannel(world, name);
      state.setRasterView((view) => ({
        ...view,
        fields: selected === "elevation" ? [] : [defaultFieldStyle(selected)],
      }));
    },
  };
}
function useSelectedFeature(world: World, areaId: string, selected: AtlasFeature | null) {
  const query = useQuery({
    queryKey: ["selected-feature", world.id, areaId, selected?.id, world.version],
    gcTime: 0,
    enabled: selected !== null,
    queryFn: async () =>
      (await atlasWorkspace()).readFeature(
        workspaceScope(world, editArea(world, areaId, selected!)),
        selected!.id
      ),
  });
  return selected ? (query.data ?? (query.error ? null : selected)) : null;
}
function useEditing(world: World, state: ReturnType<typeof useEditorState>) {
  const { areaId, setStyles } = state;
  const commit = useCommit(world.id);
  function execute(kind: string, data: Record<string, unknown>) {
    commit.mutate(
      makeCommand(world, kind === "sculptField" ? "paintMapField" : kind, { areaId, ...data })
    );
  }
  function saveFeature(feature: AtlasFeature) {
    const target = editArea(world, areaId, feature);
    const edit = { areaId: target, feature: scopedFootprint(world, target, feature) };
    commit.mutate(makeCommand(world, "putMapFeature", edit), {
      onSuccess: () =>
        setStyles((current) =>
          completeStyles(world, current).map((style) =>
            style.layerId === feature.layerId ? { ...style, visible: true } : style
          )
        ),
    });
  }
  return { commit, execute, saveFeature };
}
function completeStyles(world: World, saved: LayerStyle[]) {
  return saved.concat(
    defaultStyles(world).filter((s) => !saved.some((previous) => previous.layerId === s.layerId))
  );
}
function presetChannel(world: World, name: string) {
  const entity = Object.values(world.entities).find((e) => e.kind === "culture");
  if (name === "cultural" && entity) return `culture:${entity.id}`;
  if (name === "magical") return magicalChannel(world);
  return "elevation";
}
function magicalChannel(world: World) {
  const available = world.fields.flatMap((field) => field.channels ?? []);
  if (available.includes("finalSurface")) return "finalSurface";
  if (world.magic.length) return `magic:${world.magic[0].id}`;
  return "elevation";
}
export type EditorState = ReturnType<typeof useEditor>;
export type EditorSessionState = ReturnType<typeof useEditorState>;
export type EditorEditing = ReturnType<typeof useEditing>;

function finishLabel(
  state: EditorSessionState,
  composition: ReturnType<typeof useComposition>,
  geometry: Geometry
) {
  if (!state.selected || !["Point", "LineString"].includes(geometry.type)) return;
  const own = { ...composition.cartography.overrides[state.selected.id] };
  delete own.anchor;
  delete own.path;
  if (geometry.type === "Point") own.anchor = [geometry.coordinates[0], geometry.coordinates[1]];
  if (geometry.type === "LineString") own.path = geometry.coordinates.map(([x, y]) => [x, y]);
  composition.finishCartography({
    ...composition.cartography,
    overrides: { ...composition.cartography.overrides, [state.selected.id]: own },
  });
  state.setTool("select");
}

export function newFeature(
  area: Area,
  geometry: Geometry,
  name: string,
  kind: string,
  layerId: string
): AtlasFeature {
  return {
    id: crypto.randomUUID(),
    areaId: area.id,
    name,
    kind,
    layerId,
    geometry,
    detail: {},
    attributes: {},
    relations: [],
    state: "authored",
    protected: true,
    actor: "user",
    generationId: null,
    causes: [],
  };
}
/** A drawn sheet depicts its whole subject, so its reads follow the subject, not the viewport:
 * panning the sheet changes no input and the illustration is assembled once per scale. */
export function mapDataExtent(
  view: CartographicPresentation,
  subject: { footprint: Geometry },
  area: Area,
  viewport: number[] | null
) {
  if (view.mode !== "drawn" || !viewport) return viewport;
  return bounds(view.clip ? subject.footprint : area.footprint);
}
export function areaInput(area: Area, geometry: Geometry, form: FormData) {
  const coordinates =
    geometry.type === "Polygon"
      ? geometry.coordinates[0][0]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates[0][0][0]
        : [0, 0];
  return {
    parentId: area.id,
    name: String(form.get("name")),
    profile: String(form.get("profile")),
    footprint: geometry,
    frame: frameAt(
      coordinates[0],
      coordinates[1],
      Number(form.get("elevation")),
      Number(form.get("rotation")),
      String(form.get("floor")) || null
    ),
    approach: String(form.get("approach")),
    context: String(form.get("context") ?? "landscape"),
    domains: form.getAll("domains").map(String),
    traits: [],
  };
}

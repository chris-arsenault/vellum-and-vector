import { useState } from "react";
import { DomainError } from "@atlas/domain";
import { bounds, defaultStyles, frameAt } from "./presentation";
import { makeCommand, useCommit } from "./useAtlas";
import type { Area, AtlasFeature, LayerStyle, Tool, World } from "./types";
import type { Geometry } from "geojson";
import { useMapData } from "./useScene";
import { editArea } from "./useScene";
import { useCartographicState } from "./useCartographicState";
import { useMapActions } from "./useMapActions";
import type { MapEngine } from "./mapEngine";
import { defaultRasterPresentation, defaultFieldStyle } from "./rasterPresentation";

function useEditorState(world: World) {
  const [selectedAreaId, setAreaId] = useState(
    Object.values(world.areas).find((a) => !a.parentId)!.id
  );
  const area = world.areas[selectedAreaId] ?? Object.values(world.areas).find((a) => !a.parentId)!;
  const areaId = area.id;
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<AtlasFeature | null>(null);
  const [savedStyles, setStyles] = useState<LayerStyle[]>(() => defaultStyles(world));
  const [selection, setSelection] = useState<Geometry | null>(null);
  const [drawing, setDrawing] = useState<Geometry | null>(null);
  const [channel, setBrushChannel] = useState("elevation");
  const [rasterView, setRasterView] = useState(defaultRasterPresentation);
  const [mapEngine, setMapEngine] = useState<MapEngine | null>(null);
  const extent = bounds(area.footprint);
  const [brush, setBrush] = useState({
    radius: (extent[2] - extent[0]) / 30,
    delta: 10,
    mode: "add" as "add" | "set" | "smooth",
  });
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
export function useEditor(world: World) {
  const state = useEditorState(world);
  const { area, savedStyles, viewport, setViewport, setStyles, setChannel } = state;
  const editing = useEditing(world, state);
  return {
    ...state,
    ...editing,
    world,
    styles: completeStyles(world, savedStyles),
    ...useMapData(world, area.id, viewport),
    viewport: setViewport,
    ...useMapActions(world, state, editing),
    preset: (name: string) => {
      setStyles(defaultStyles(world, name));
      setChannel(presetChannel(world, name));
      const selected = presetChannel(world, name);
      state.setRasterView((view) => ({
        ...view,
        fields: selected === "elevation" ? [] : [defaultFieldStyle(selected)],
      }));
    },
  };
}
function useEditing(world: World, state: ReturnType<typeof useEditorState>) {
  const {
    areaId,
    pendingEdits,
    reconciling,
    setPendingEdits,
    setProposedFeatures,
    setPendingSculpt,
    setTool,
    setPanel,
  } = state;
  const commit = useCommit(world.id);
  function execute(kind: string, data: Record<string, unknown>) {
    commit.mutate(makeCommand(world, kind, { areaId, ...data }), {
      onError: (error) => {
        if (
          kind === "sculptField" &&
          error instanceof DomainError &&
          ["locked_boundary", "locked_field_boundary"].includes(error.code)
        ) {
          setPendingSculpt(data);
          setTool("select");
          setPanel("reconcile");
        }
      },
    });
  }
  function saveFeature(feature: AtlasFeature) {
    const edit = { areaId: editArea(world, areaId, feature), feature };
    const stage = () => {
      const edits = [...pendingEdits.filter((e) => e.feature.id !== feature.id), edit];
      setPendingEdits(edits);
      setProposedFeatures(edits.map((e) => e.feature));
      setPanel("reconcile");
      setTool("select");
    };
    if (reconciling) {
      stage();
      return;
    }
    commit.mutate(makeCommand(world, "putFeature", edit), {
      onError: (error) => {
        if (
          error instanceof DomainError &&
          [
            "locked_boundary",
            "locked_field_boundary",
            "locked_junction",
            "attached_connection",
            "attached_water_transfer",
            "locked_flow",
            "junction_water_level",
            "water_budget",
          ].includes(error.code)
        )
          stage();
      },
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

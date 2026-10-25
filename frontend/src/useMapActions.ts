import type { Geometry } from "geojson";
import { bounds, frameAt, rectangle } from "./presentation";
import { makeCommand } from "./useAtlas";
import { session } from "./atlasState";
import { brushChannel, drawingDefinition, type Workspace } from "./cartography";
import {
  drawnFeature,
  landmarkInput,
  magicInput,
  regionExtent,
  sourceFootprint,
} from "./mapAuthoring";
import type { EditorEditing, EditorSessionState } from "./useEditor";
import type { AtlasFeature, Position, Template, Tool, World } from "./types";

export function useMapActions(world: World, state: EditorSessionState, editing: EditorEditing) {
  const select = (feature: AtlasFeature | null) => {
    state.setGeometryRole("primary");
    state.setSelected(feature);
    const source = world.magic.find((source) => source.id === feature?.id);
    const landmark = world.landmarks.find((landmark) => landmark.id === feature?.id);
    if (source) {
      state.setMagicDraft({ id: source.id, source: source.source, radius: source.radius });
      state.setPanel("magic");
    } else if (landmark) {
      state.setLandmarkDraft({ id: landmark.id, geometry: landmark.geometry });
      state.setPanel("landmark");
    } else state.setPanel("inspect");
  };
  const extent = (geometry: Geometry) => {
    try {
      state.setSelection(regionExtent(state.area, geometry));
      state.setTool("extentEdit");
      state.setPanel("refine");
      state.setInteractionError(null);
    } catch (error) {
      state.setInteractionError(error as Error);
    }
  };
  const chooseTool = (tool: Tool) => {
    state.setInteractionError(null);
    if (tool === "sculpt" && !prepareBrush(world, state)) return;
    const problem = toolProblem(world, state, tool);
    if (problem) {
      state.setPanel("author");
      state.setInteractionError(new Error(problem));
      return;
    }
    state.setTool(tool);
    if (tool.startsWith("region")) state.setPanel("regions");
    else if (["refine", "refinePolygon", "extentEdit"].includes(tool)) state.setPanel("refine");
    else if (tool === "magic") state.setPanel("magic");
    else if (tool === "landmark" || tool === "landmarkPath") state.setPanel("landmark");
    else if (!["select", "pan", "move", "reshape"].includes(tool)) state.setPanel("author");
  };
  return {
    select,
    selectExtent: extent,
    setTool: chooseTool,
    draw: (geometry: Geometry) => completeDrawing(world, state, editing, geometry, extent),
    enter: (id: string) => enterArea(world, state, id),
    cancel: () => cancelDrawing(state),
    ...geometryActions(world, state, editing),
    setWorkspace: (workspace: Workspace) => chooseWorkspace(world, state, workspace),
    placeTemplate: (template: Template) => {
      state.setTemplateToPlace(template);
      state.setTool("template");
      state.setPanel("author");
    },
    refinePoi: (feature: AtlasFeature) => extent(placeExtent(feature)),
  };
}
function toolProblem(world: World, state: EditorSessionState, tool: Tool) {
  if (tool.startsWith("survey") && !world.layers[state.customLayer])
    return "Choose a custom layer before drawing.";
  if (
    ["border", "administration", "claim", "control"].includes(tool) &&
    world.entities[state.entityId]?.kind !== "polity"
  )
    return "Choose or name a polity before drawing its boundaries.";
  return null;
}
function prepareBrush(world: World, state: EditorSessionState) {
  const channel = brushChannel(world, state.workspace, state.entityId, state.customLayer);
  if (!channel) {
    state.setPanel("author");
    state.setInteractionError(
      new Error("Choose a community or custom field layer before painting.")
    );
    return false;
  }
  state.setChannel(channel);
  if (state.workspace === "cultures" && state.brush.mode !== "set")
    state.setBrush({ ...state.brush, mode: "set", delta: 1 });
  return true;
}
function chooseWorkspace(world: World, state: EditorSessionState, workspace: Workspace) {
  cancelDrawing(state);
  state.setWorkspace(workspace);
  revealWorkspace(world, state, workspace);
  state.setPanel(workspace === "magic" ? "magic" : "author");
  state.setSelected(null);
  state.setDrawName("");
  state.setDrawAttributes({});
  if (workspace === "terrain") {
    state.setChannel("elevation");
    state.setBrush({ ...state.brush, mode: "add", delta: 10 });
  }
}
function cancelDrawing(state: EditorSessionState) {
  state.setTool("select");
  state.setDrawing(null);
  state.setSelection(null);
  state.setMagicDraft(null);
  state.setTemplateToPlace(null);
  state.setInteractionError(null);
  state.setPanel("author");
}
function revealWorkspace(world: World, state: EditorSessionState, workspace: Workspace) {
  const families: Record<Workspace, string[]> = {
    terrain: ["physical", "custom"],
    water: ["water"],
    routes: ["transport"],
    places: ["built", "custom"],
    politics: ["political"],
    cultures: ["cultural"],
    magic: ["magic"],
    interior: ["built", "custom"],
    custom: ["custom"],
  };
  state.setStyles(
    state.savedStyles.map((style) =>
      families[workspace].includes(world.layers[style.layerId]?.family)
        ? { ...style, visible: true }
        : style
    )
  );
}
function placeExtent(feature: AtlasFeature) {
  if (feature.geometry.type !== "Point") return feature.geometry;
  const [x, y] = feature.geometry.coordinates;
  return rectangle(x - 25, y - 25, 50, 50);
}
function enterArea(world: World, state: EditorSessionState, id: string) {
  const area = session(world.id).snapshot.world.areas[id] ?? state.area,
    box = bounds(area.footprint);
  state.setAreaId(id);
  state.setRegionId(null);
  state.setViewport(null);
  state.setSelected(null);
  state.setSelection(null);
  state.setDrawing(null);
  state.setTool("select");
  state.setPanel("generate");
  state.setBrush({ ...state.brush, radius: (box[2] - box[0]) / 30 });
  state.setWorkspace(area.profile === "interior" ? "interior" : "terrain");
  state.setMagicDraft(null);
  state.setLandmarkDraft(null);
  state.setTemplateToPlace(null);
}
function geometryActions(world: World, state: EditorSessionState, editing: EditorEditing) {
  return {
    modify: (feature: AtlasFeature, geometry: Geometry, role?: "footprint") => {
      if (role === "footprint") {
        editing.saveFeature({ ...feature, footprint: geometry, protected: true });
        return;
      }
      const source = world.magic.find((source) => source.id === feature.id);
      const landmark = world.landmarks.find((landmark) => landmark.id === feature.id);
      if (landmark && geometry.type === landmark.geometry.type) {
        editing.commit.mutate(
          makeCommand(world, "putLandmark", {
            ...landmarkInput(landmark),
            areaId: landmark.areaId ?? state.areaId,
            geometry,
          }),
          { onSuccess: () => state.setLandmarkDraft({ id: landmark.id, geometry }) }
        );
        return;
      }
      if (source && geometry.type === "Point")
        editing.commit.mutate(
          makeCommand(world, "putMagicSource", {
            ...magicInput(source),
            areaId: source.areaId ?? state.areaId,
            source: { x: geometry.coordinates[0], y: geometry.coordinates[1], z: source.source.z },
          }),
          {
            onSuccess: () =>
              state.setMagicDraft({
                id: source.id,
                source: {
                  x: geometry.coordinates[0],
                  y: geometry.coordinates[1],
                  z: source.source.z,
                },
                radius: source.radius,
              }),
          }
        );
      else editing.saveFeature({ ...feature, geometry, protected: true });
    },
    stroke: (points: Position[]) => {
      if (points.length)
        editing.execute("sculptField", {
          areaId: state.areaId,
          channel: state.channel,
          center: { ...points[0], z: state.area.frame.origin.z },
          stroke: points,
          ...state.brush,
        });
    },
  };
}
function completeDrawing(
  world: World,
  state: EditorSessionState,
  editing: EditorEditing,
  geometry: Geometry,
  extent: (geometry: Geometry) => void
) {
  if (["refine", "refinePolygon"].includes(state.tool)) {
    extent(geometry);
    return;
  }
  if (["landmark", "landmarkPath", "magic"].includes(state.tool)) {
    beginInputDraft(state, geometry);
    return;
  }
  if (state.tool === "hill") {
    const { source, radius } = sourceFootprint(geometry);
    editing.execute("putLandform", {
      areaId: state.areaId,
      name: state.drawName.trim() || "Authored hill",
      center: source,
      radius,
      height: Number(state.drawAttributes.height ?? 100),
    });
    return;
  }
  if (state.tool === "template") {
    placeTemplate(world, state, editing, geometry);
    return;
  }
  const definition = drawingDefinition(state.tool, state.customLayer, world);
  if (!definition) return;
  const feature = drawnFeature(world, state.area, geometry, definition, {
    name: state.drawName,
    entityId: state.entityId,
    attributes: state.drawAttributes,
  });
  if (["culture", "language", "religion"].includes(state.tool)) {
    placeCommunity(world, state, editing, feature);
    return;
  }
  editing.commit.mutate(makeCommand(world, "putFeature", { areaId: state.areaId, feature }), {
    onSuccess: () => {
      state.setSelected(feature);
      state.setDrawing(null);
      state.setDrawName("");
      state.setPanel("inspect");
      state.setTool("select");
    },
    onError: () => {
      state.setSelected(feature);
      state.setDrawing(geometry);
      state.setPanel("feature");
      state.setTool("select");
    },
  });
}
/** A drawn world-level input opens its panel for naming and measures before it is saved. */
function beginInputDraft(state: EditorSessionState, geometry: Geometry) {
  if (state.tool === "magic") {
    const footprint = sourceFootprint(geometry);
    state.setMagicDraft({
      id: null,
      ...footprint,
      source: { ...footprint.source, z: state.area.frame.origin.z },
    });
  } else state.setLandmarkDraft({ id: null, geometry });
  const panel = state.tool === "magic" ? "magic" : "landmark";
  state.setTool("select");
  state.setPanel(panel);
}
function placeCommunity(
  world: World,
  state: EditorSessionState,
  editing: EditorEditing,
  feature: AtlasFeature
) {
  if (feature.geometry.type !== "Point") return;
  const id = crypto.randomUUID(),
    kind = state.tool,
    [x, y] = feature.geometry.coordinates;
  feature.relations = [{ targetId: id, kind: "originOf" }];
  editing.commit.mutate(
    makeCommand(world, "putEntity", {
      areaId: state.areaId,
      id,
      name:
        state.drawName.trim() ||
        `${kind} ${Object.values(world.entities).filter((e) => e.kind === kind).length + 1}`,
      kind,
      attributes: { center: { x, y, z: state.area.frame.origin.z }, initialPopulation: 100 },
      relations: [],
      origin: { areaId: state.areaId, feature },
    }),
    {
      onSuccess: () => {
        state.setEntityId(id);
        state.setChannel(`${kind}:${id}`);
        state.setBrush({ ...state.brush, mode: "set", delta: 1 });
        state.setTool("select");
        state.setPanel("author");
        state.setDrawName("");
      },
    }
  );
}
function placeTemplate(
  world: World,
  state: EditorSessionState,
  editing: EditorEditing,
  geometry: Geometry
) {
  const template = state.templateToPlace;
  if (!template || geometry.type !== "Point") return;
  const [x, y] = geometry.coordinates;
  editing.commit.mutate(
    makeCommand(world, "instantiateTemplate", {
      templateId: template.id,
      definitionVersion: template.version ?? 1,
      parentId: state.areaId,
      name: template.name,
      frame: frameAt(x, y, state.area.frame.origin.z, 0, "ground"),
      contextFeatureId: state.selected?.kind === "building" ? state.selected.id : null,
      bindings: Object.fromEntries(
        (template.sockets ?? [])
          .filter((socket) => socket.required && !socket.connectsTo && state.selected)
          .map((socket) => [socket.id, state.selected!.id])
      ),
    }),
    {
      onSuccess: () => {
        state.setTool("select");
        state.setTemplateToPlace(null);
        state.setPanel("generate");
      },
    }
  );
}

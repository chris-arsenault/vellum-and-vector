import type { Layer, Tool, World } from "./types";
import { layerSupports } from "@atlas/domain";

export type Workspace =
  | "terrain"
  | "water"
  | "routes"
  | "places"
  | "politics"
  | "cultures"
  | "magic"
  | "interior"
  | "custom";
export interface DrawingTool {
  label: string;
  geometry: "Point" | "LineString" | "Polygon" | "Circle";
  kind: string;
  layer: string;
  instruction: string;
}
export const workspaces: Record<Workspace, string> = {
  terrain: "Terrain",
  water: "Rivers & lakes",
  routes: "Roads & routes",
  places: "Places & buildings",
  politics: "Political boundaries",
  cultures: "Cultures & communities",
  magic: "Magic",
  interior: "Rooms & interiors",
  custom: "Custom layer",
};
export const drawingTools: Partial<Record<Tool, DrawingTool>> = {
  hill: {
    label: "Raise landform",
    geometry: "Circle",
    kind: "hill",
    layer: "geology",
    instruction: "Click the summit, then the edge of its footprint. Height is set in the panel.",
  },
  administration: {
    label: "Draw administration",
    geometry: "Polygon",
    kind: "administration",
    layer: "administration",
    instruction: "Trace an administrative district for the selected polity.",
  },
  poi: {
    label: "Place point",
    geometry: "Point",
    kind: "poi",
    layer: "pois",
    instruction: "Click to place a named location.",
  },
  road: {
    label: "Draw road",
    geometry: "LineString",
    kind: "road",
    layer: "roads",
    instruction: "Trace the route. Double-click or press Enter to finish.",
  },
  river: {
    label: "Draw river",
    geometry: "LineString",
    kind: "river",
    layer: "rivers",
    instruction: "Trace downstream. Double-click or press Enter to finish.",
  },
  polygon: {
    label: "Draw polygon",
    geometry: "Polygon",
    kind: "survey",
    layer: "pois",
    instruction: "Click around the outline. Double-click or press Enter to finish.",
  },
  lake: {
    label: "Draw lake",
    geometry: "Polygon",
    kind: "lake",
    layer: "lakes",
    instruction: "Trace the shoreline. Double-click to finish.",
  },
  forest: {
    label: "Draw woodland",
    geometry: "Polygon",
    kind: "forest",
    layer: "ecology",
    instruction: "Trace the woodland's extent. Double-click to finish.",
  },
  settlement: {
    label: "Place settlement",
    geometry: "Point",
    kind: "settlement",
    layer: "settlements",
    instruction: "Click the settlement's location.",
  },
  building: {
    label: "Draw building",
    geometry: "Polygon",
    kind: "building",
    layer: "structures",
    instruction: "Draw the footprint; you can develop its interior afterwards.",
  },
  room: {
    label: "Draw room",
    geometry: "Polygon",
    kind: "room",
    layer: "structures",
    instruction: "Trace the room on this floor. Double-click to finish.",
  },
  wall: {
    label: "Draw wall",
    geometry: "LineString",
    kind: "wall",
    layer: "structures",
    instruction: "Trace the wall. Double-click to finish.",
  },
  door: {
    label: "Place door",
    geometry: "Point",
    kind: "door",
    layer: "structures",
    instruction: "Click a doorway on this floor.",
  },
  border: {
    label: "Draw territory",
    geometry: "Polygon",
    kind: "sovereignty",
    layer: "sovereignty",
    instruction: "Trace sovereign territory for the selected polity.",
  },
  claim: {
    label: "Draw claim",
    geometry: "Polygon",
    kind: "claim",
    layer: "claims",
    instruction: "Trace a territorial claim. Claims can overlap.",
  },
  control: {
    label: "Draw control",
    geometry: "Polygon",
    kind: "control",
    layer: "control",
    instruction: "Trace effective control independently of sovereignty and claims.",
  },
  culture: {
    label: "Place cultural origin",
    geometry: "Point",
    kind: "culturalOrigin",
    layer: "cultures",
    instruction: "Click to locate a culture's origin or community.",
  },
  language: {
    label: "Place language center",
    geometry: "Point",
    kind: "languageCenter",
    layer: "languages",
    instruction: "Click to locate a language community.",
  },
  religion: {
    label: "Place religious center",
    geometry: "Point",
    kind: "religiousCenter",
    layer: "religions",
    instruction: "Click to locate a religious community.",
  },
  magic: {
    label: "Place magical source",
    geometry: "Circle",
    kind: "magicSource",
    layer: "magic",
    instruction: "Click the source, then click its reach. Configure its effects in the panel.",
  },
  template: {
    label: "Place template",
    geometry: "Point",
    kind: "template",
    layer: "structures",
    instruction: "Click to place the chosen template in this mapped area.",
  },
  surveyPoint: {
    label: "Place survey point",
    geometry: "Point",
    kind: "survey",
    layer: "pois",
    instruction: "Click a location in the selected custom layer.",
  },
  surveyLine: {
    label: "Draw survey line",
    geometry: "LineString",
    kind: "survey",
    layer: "pois",
    instruction: "Trace a line in the selected custom layer.",
  },
  surveyPolygon: {
    label: "Draw survey area",
    geometry: "Polygon",
    kind: "survey",
    layer: "pois",
    instruction: "Trace an area in the selected custom layer.",
  },
};
const palettes: Record<Workspace, Tool[]> = {
  terrain: ["sculpt", "hill", "forest", "poi"],
  water: ["river", "lake"],
  routes: ["road"],
  places: ["settlement", "building", "poi"],
  politics: ["border", "administration", "claim", "control"],
  cultures: ["culture", "language", "religion", "sculpt"],
  magic: ["magic"],
  interior: ["room", "wall", "door", "poi"],
  custom: ["surveyPoint", "surveyLine", "surveyPolygon", "sculpt"],
};
export const paletteTools = (workspace: Workspace, layer?: Layer) =>
  palettes[workspace].filter(
    (tool) =>
      workspace !== "custom" ||
      !layer ||
      layerSupports(layer, tool === "sculpt" ? "field" : "vector")
  );
export function toolLabel(tool: Tool): string {
  return (
    drawingTools[tool]?.label ??
    (
      {
        select: "Select",
        inspectCell: "Inspect cell",
        labelPlace: "Place label",
        labelPath: "Draw label curve",
        pan: "Pan map",
        move: "Move feature",
        reshape: "Reshape",
        refine: "Locate another map",
        refinePolygon: "Draw region polygon",
        extentEdit: "Adjust region outline",
        regionPick: "Pick geographic region",
        regionOutline: "Draw geographic region outline",
        regionCut: "Draw geographic dividing line",
        regionEdit: "Adjust geographic region outline",
        sculpt: "Paint field",
      } as Partial<Record<Tool, string>>
    )[tool]!
  );
}
export function toolInstruction(tool: Tool): string {
  return (
    drawingTools[tool]?.instruction ??
    (
      {
        select: "Select a feature; double-click an area to enter it.",
        inspectCell: "Click a cell to inspect all of its stored numerical values.",
        labelPlace: "Click to place the selected feature's label in this composition.",
        labelPath: "Draw the label's course; double-click or press Enter to finish.",
        pan: "Drag to move around the map.",
        move: "Drag the selected feature to move it.",
        reshape: "Drag vertices; Alt-click a vertex to remove it.",
        refine: "Drag a rectangle over the geography to develop.",
        refinePolygon: "Trace a region outline; double-click to finish.",
        extentEdit: "Adjust the outline, then create the region.",
        regionPick: "Click a place to preview a region at this map scale.",
        regionOutline: "Trace the region outline; double-click or press Enter to finish.",
        regionCut:
          "Join existing boundaries with a dividing line; double-click or press Enter to finish.",
        regionEdit: "Drag outline vertices, then keep the region.",
        sculpt: "Drag to paint the field; hold Space to pan.",
      } as Partial<Record<Tool, string>>
    )[tool]!
  );
}
export function drawingDefinition(tool: Tool, customLayer: string, world: World) {
  const definition = drawingTools[tool];
  if (!definition) return null;
  return tool.startsWith("survey") && world.layers[customLayer]
    ? { ...definition, layer: customLayer }
    : definition;
}
export function brushChannel(
  world: World,
  workspace: Workspace,
  entityId: string,
  customLayer: string
): string | null {
  if (workspace === "custom") return world.layers[customLayer] ? customLayer : null;
  if (workspace !== "cultures") return "elevation";
  const entity = world.entities[entityId];
  return entity && ["culture", "language", "religion"].includes(entity.kind)
    ? `${entity.kind}:${entity.id}`
    : null;
}

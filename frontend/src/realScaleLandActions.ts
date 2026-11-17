import type { MapDescriptor } from "@atlas/map";
import type { EditAction } from "./realScaleActions";
import { kindSize, layerOf } from "./realScaleLandTools";
import type { AuthoringSession, DrawChoice, EditTool } from "./useRealScaleAuthoring";

/** One land tool: the canvas tool it takes up, the layer family it draws into and the kind
 * it starts with where that layer has it. Layers, kinds and sizes come from the map. */
export interface LandTool {
  id: string;
  name: string;
  shortcut: string;
  tool: EditTool;
  family?: string;
  kind?: string;
}
export const landTools: LandTool[] = [
  {
    id: "water",
    name: "Draw a river or stream",
    shortcut: "R",
    tool: "draw",
    family: "rivers",
    kind: "stream",
  },
  {
    id: "trail",
    name: "Draw a trail or path",
    shortcut: "T",
    tool: "draw",
    family: "roads",
    kind: "trail",
  },
  {
    id: "object",
    name: "Place an object",
    shortcut: "O",
    tool: "place",
    family: "objects",
    kind: "boulder",
  },
  {
    id: "scatter",
    name: "Scatter objects over an outline",
    shortcut: "S",
    tool: "scatter",
    family: "objects",
    kind: "rubble",
  },
  { id: "cave-wall", name: "Draw a cave wall", shortcut: "W", tool: "draw", family: "caveWalls" },
  { id: "hexes", name: "Select hexes", shortcut: "H", tool: "hexes" },
];
/** The layer and kind a land tool starts with on this map, at the kind's typical size. */
export function landDraw(map: MapDescriptor, land: LandTool): DrawChoice | null {
  const layer = land.family ? layerOf(map, land.family) : undefined;
  const types = layer?.catalog.featureTypes ?? [];
  const kind = (types.find((t) => t.kind === land.kind) ?? types.find((t) => t.trueSize))?.kind;
  if (!layer || !kind) return null;
  const width = kindSize(map, layer.id, kind)?.typical ?? 1;
  return { layerId: layer.id, kind, name: "", width };
}
/** Why a land tool cannot be used on this map, or null. */
export function landBlocked(session: AuthoringSession, land: LandTool) {
  if (!land.family || landDraw(session.map, land)) return null;
  return "This map has no layer for that";
}
export function chooseLand(session: AuthoringSession, land: LandTool) {
  const draw = land.family ? landDraw(session.map, land) : session.state.draw;
  session.set({ tool: land.tool, draw, ...(land.tool === "hexes" ? { selected: [] } : {}) });
}
/** Whether a land tool is the one in hand. */
export function landActive(session: AuthoringSession, land: LandTool) {
  const { tool, draw } = session.state;
  if (tool !== land.tool) return false;
  if (land.tool !== "draw" || !land.family) return true;
  return draw?.layerId === landDraw(session.map, land)?.layerId;
}
export const landActions: EditAction[] = landTools.map((land) => ({
  id: `land-${land.id}`,
  name: land.name,
  shortcut: land.shortcut,
  blocked: ({ session }) => landBlocked(session, land),
  run: ({ session }) => chooseLand(session, land),
}));

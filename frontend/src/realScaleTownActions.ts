import type { EditAction } from "./realScaleActions";
import type { AuthoringSession, EditTool } from "./useRealScaleAuthoring";
import { vectorFamily } from "./publishedAppearance";

/** The search field the Find an address action moves to. */
export const addressFieldId = "real-scale-find-address";

/** One town tool: the canvas tool it takes up and the layer family it lays into. */
export interface TownTool {
  id: string;
  name: string;
  shortcut: string;
  tool: EditTool;
  family: string;
}
export const townTools: TownTool[] = [
  { id: "street", name: "Draw a street", shortcut: "L", tool: "street", family: "roads" },
  {
    id: "building",
    name: "Place a building",
    shortcut: "B",
    tool: "building",
    family: "structures",
  },
];
/** Why a town tool cannot be used on this map, or null. */
export function townBlocked(session: AuthoringSession, town: TownTool) {
  if (session.map.realScale?.kind !== "ground") return "Town tools belong to ground maps";
  return session.map.layers.some((layer) => vectorFamily(layer.id) === town.family)
    ? null
    : "This map has no layer for that";
}
export const townActions: EditAction[] = [
  ...townTools.map((town): EditAction => ({
    id: `town-${town.id}`,
    name: town.name,
    shortcut: town.shortcut,
    blocked: ({ session }) => townBlocked(session, town),
    run: ({ session }) => session.set({ tool: town.tool }),
  })),
  {
    id: "find-address",
    name: "Find an address",
    shortcut: "F",
    blocked: () => null,
    run: () => document.getElementById(addressFieldId)?.focus(),
  },
];

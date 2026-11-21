import { drawChoiceForTool, kindEntries, type KindEntry } from "./authoredKinds";
import { clampRadius, interactionFor, toolByKey, type AuthoredTool } from "./authoredState";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** Pick a toolbar tool: it sets the canvas interaction and, for the drawing tools, what
 * they draw. Hex-only choices never arise on an authored map. */
export function chooseAuthoredTool(session: AuthoringSession, tool: AuthoredTool) {
  const { authored, draw } = session.state;
  session.set({
    tool: interactionFor(tool),
    authored: { ...authored, tool },
    draw: drawChoiceForTool(tool, kindEntries(session.map), authored.kind, draw),
  });
}
/** Arm the Place tool with a catalogue kind; the kind's suggested geometry is what gets drawn. */
export function armKind(session: AuthoringSession, entry: KindEntry) {
  const { authored, draw } = session.state;
  const armed = { ...authored, tool: "place" as const, kind: entry.key };
  session.set({
    tool: "draw",
    authored: armed,
    draw: drawChoiceForTool("place", [entry], entry.key, draw),
  });
}
export function setBrush(
  session: AuthoringSession,
  change: Partial<AuthoringSession["state"]["authored"]["brush"]>
) {
  const { authored } = session.state;
  const brush = { ...authored.brush, ...change };
  session.set({
    authored: {
      ...authored,
      brush: { ...brush, radius: clampRadius(brush.radius, session.map.bounds) },
    },
  });
}
export function setShape(
  session: AuthoringSession,
  change: Partial<AuthoringSession["state"]["authored"]["shape"]>
) {
  const { authored } = session.state;
  session.set({ authored: { ...authored, shape: { ...authored.shape, ...change } } });
}
export function setName(session: AuthoringSession, name: string) {
  const { draw } = session.state;
  if (draw) session.set({ draw: { ...draw, name } });
}

/** Carry out a shortcut. Undo and Redo reach feature and terrain edits in the order done. */
export function runShortcut(session: AuthoringSession, action: ShortcutAction) {
  if (action.type === "tool") return chooseAuthoredTool(session, action.tool);
  if (action.type === "undo") return session.canUndo ? void session.undo() : undefined;
  if (action.type === "redo") return session.canRedo ? void session.redo() : undefined;
  if (action.type === "clear") return session.set({ selected: [] });
  if (action.type === "radius")
    return setBrush(session, { radius: session.state.authored.brush.radius * action.factor });
  const ids = session.state.selected;
  if (ids.length)
    void session.run({ command: "delete", ids }).then(() => session.set({ selected: [] }));
}
export type ShortcutAction =
  | { type: "tool"; tool: AuthoredTool }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "radius"; factor: number }
  | { type: "delete" }
  | { type: "clear" };
interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}
const plainKeys: Record<string, ShortcutAction> = {
  "[": { type: "radius", factor: 1 / 1.25 },
  "]": { type: "radius", factor: 1.25 },
  Escape: { type: "clear" },
  Delete: { type: "delete" },
  Backspace: { type: "delete" },
};
function commandShortcut(event: KeyPress): ShortcutAction | null {
  const key = event.key.toLowerCase();
  if (key === "z") return { type: event.shiftKey ? "redo" : "undo" };
  return key === "y" ? { type: "redo" } : null;
}
/** The action a key press names, or null. Callers skip presses made inside a field. */
export function shortcutFor(event: KeyPress): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey) return commandShortcut(event);
  if (event.altKey) return null;
  if (Object.hasOwn(plainKeys, event.key)) return plainKeys[event.key];
  const tool = event.key.length === 1 ? toolByKey(event.key) : undefined;
  return tool ? { type: "tool", tool: tool.id } : null;
}

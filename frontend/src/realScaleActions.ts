import { collectPages, type MapFeature, type MapReader } from "@atlas/map";
import { defaultDraw, type AuthoringSession, type EditTool } from "./useRealScaleAuthoring";
import { landActions } from "./realScaleLandActions";
import { townActions } from "./realScaleTownActions";

/** One name, one shortcut and one rule per editing action; the palette lists them all. */
export interface EditAction {
  id: string;
  name: string;
  shortcut: string;
  /** Why the action is unavailable now, or null. */
  blocked(context: ActionContext): string | null;
  run(context: ActionContext): unknown;
}
export interface ActionContext {
  session: AuthoringSession;
  reader: MapReader;
  selected: MapFeature[];
  openPalette(): void;
}
const needsSelection = ({ session }: ActionContext) =>
  session.state.selected.length ? null : "Select a shape first";
const tool = (id: EditTool, name: string, shortcut: string): EditAction => ({
  id: `tool-${id}`,
  name,
  shortcut,
  blocked: () => null,
  run: ({ session }) => chooseTool(session, id),
});
export function chooseTool(session: AuthoringSession, tool: EditTool) {
  const draw =
    tool === "draw" ? (session.state.draw ?? defaultDraw(session.map)) : session.state.draw;
  session.set({ tool, draw });
}
export const editActions: EditAction[] = [
  tool("select", "Select and move", "V"),
  tool("points", "Edit points", "P"),
  tool("draw", "Draw a shape", "D"),
  {
    id: "undo",
    name: "Undo",
    shortcut: "Ctrl+Z",
    blocked: ({ session }) => (session.canUndo ? null : "Nothing to undo"),
    run: ({ session }) => session.undo(),
  },
  {
    id: "redo",
    name: "Redo",
    shortcut: "Ctrl+Shift+Z",
    blocked: ({ session }) => (session.canRedo ? null : "Nothing to redo"),
    run: ({ session }) => session.redo(),
  },
  {
    id: "delete",
    name: "Delete selection",
    shortcut: "Delete",
    blocked: needsSelection,
    run: async ({ session }) => {
      if (await session.run({ command: "delete", ids: session.state.selected }))
        session.set({ selected: [] });
    },
  },
  {
    id: "duplicate",
    name: "Duplicate selection",
    shortcut: "Ctrl+D",
    blocked: needsSelection,
    run: async ({ session }) => {
      const step = session.map.realScale?.acrossFlats ?? 1;
      const outcome = await session.run({
        command: "duplicate",
        ids: session.state.selected,
        offset: [step, -step / 2],
      });
      const created = outcome?.changed.filter((id) => !session.state.selected.includes(id));
      if (created?.length) session.set({ selected: created });
    },
  },
  {
    id: "same-kind",
    name: "Select same kind",
    shortcut: "Ctrl+Shift+A",
    blocked: ({ selected }) => (selected.length ? null : "Select a shape first"),
    run: async ({ session, reader, selected }) => {
      const [first] = selected;
      const features = await collectPages((cursor) =>
        reader.features(session.map.reference, {
          spaceId: first.spaceId,
          layerIds: [first.layerId],
          cursor,
        })
      );
      session.set({
        selected: features.filter((f) => f.kind === first.kind).map((f) => f.id),
      });
    },
  },
  {
    id: "copy-style",
    name: "Copy style",
    shortcut: "Ctrl+Alt+C",
    blocked: ({ session }) =>
      session.state.selected.length === 1 ? null : "Select one shape to copy its style",
    run: ({ session }) => session.set({ styleSource: session.state.selected[0] }),
  },
  {
    id: "paste-style",
    name: "Paste style",
    shortcut: "Ctrl+Alt+V",
    blocked: (context) =>
      context.session.state.styleSource ? needsSelection(context) : "Copy a style first",
    run: ({ session }) =>
      session.run({
        command: "pasteStyle",
        source: session.state.styleSource!,
        ids: session.state.selected.filter((id) => id !== session.state.styleSource),
      }),
  },
  {
    id: "lock",
    name: "Lock or unlock selection",
    shortcut: "Ctrl+L",
    blocked: needsSelection,
    run: ({ session, selected }) => {
      const locked = selected.every((feature) => feature.attributes.locked === true);
      return session.run({
        command: "setAttributes",
        ids: session.state.selected,
        name: null,
        attributes: { locked: locked ? null : true },
      });
    },
  },
  {
    id: "keep-tool",
    name: "Keep tool in hand",
    shortcut: "K",
    blocked: () => null,
    run: ({ session }) => session.set({ keepTool: !session.state.keepTool }),
  },
  {
    id: "palette",
    name: "Search commands",
    shortcut: "Ctrl+K",
    blocked: () => null,
    run: ({ openPalette }) => openPalette(),
  },
  ...landActions,
  ...townActions,
];

/** The shortcut a key press names, in the palette's spelling. */
export function shortcutOf(event: KeyboardEvent) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts = [
    event.ctrlKey || event.metaKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key === "Backspace" ? "Delete" : key,
  ];
  return parts.filter(Boolean).join("+");
}
export function actionFor(event: KeyboardEvent) {
  const typed = shortcutOf(event);
  if (typed === "Ctrl+Y") return editActions.find((action) => action.id === "redo");
  return editActions.find((action) => action.shortcut === typed);
}

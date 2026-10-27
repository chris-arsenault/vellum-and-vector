import { areaSpace, isDescendant, layerSupports } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import { makeCommand } from "./useAtlas";
import { brushChannel } from "./cartography";

function brushField(world: World, editor: EditorState) {
  const channel =
    brushChannel(world, editor.workspace, editor.entityId, editor.customLayer) ?? editor.channel;
  const field = [...world.fields]
    .reverse()
    .find(
      (field) =>
        field.channels?.includes(channel) &&
        areaSpace(world, field.areaId) === areaSpace(world, editor.area.id) &&
        isDescendant(world.areas, editor.area.id, field.areaId)
    );
  const cultural = /^(culture|language|religion):/.test(channel);
  const layers: Record<string, string> = {
    culture: "cultures",
    language: "languages",
    religion: "religions",
  };
  const layerId = cultural
    ? layers[channel.split(":")[0]]
    : editor.workspace === "custom"
      ? editor.customLayer
      : "elevation";
  return { channel, field, cultural, layerId };
}
export function FieldBrush({ world, editor }: { world: World; editor: EditorState }) {
  const info = brushField(world, editor),
    layer = world.layers[info.layerId];
  const begin = () => {
    editor.setChannel(info.channel);
    editor.setTool("sculpt");
  };
  if (!layer || !layerSupports(layer, "field")) return null;
  return (
    <fieldset>
      <legend>{info.cultural ? "Prevalence brush" : "Field brush"}</legend>
      {!info.field ? (
        <>
          <p>Start a sampled {info.channel} field in this area to paint it directly.</p>
          <button
            disabled={editor.commit.isPending}
            onClick={() => {
              begin();
              editor.commit.mutate(
                makeCommand(world, "createField", {
                  id: crypto.randomUUID(),
                  areaId: editor.area.id,
                  layerId: info.layerId,
                  footprint: editor.area.footprint,
                  width: 96,
                  height: 96,
                  channels: {
                    [info.channel]: {
                      unit: info.channel === "elevation" ? "metre" : "ratio",
                      values: 0,
                    },
                  },
                })
              );
            }}
          >
            Start blank field
          </button>
        </>
      ) : (
        <>
          <BrushControls editor={editor} cultural={info.cultural} />
          <button aria-pressed={editor.tool === "sculpt"} onClick={begin}>
            Paint on map
          </button>
          <p className="hint">Drag a stroke. The whole stroke is one undoable edit.</p>
        </>
      )}
    </fieldset>
  );
}
const actions = {
  raise: { mode: "add", delta: 10 },
  lower: { mode: "add", delta: -10 },
  smooth: { mode: "smooth", delta: 0.5 },
  presence: { mode: "set", delta: 1 },
  erase: { mode: "set", delta: 0 },
} as const;
function brushAction(editor: EditorState, cultural: boolean) {
  if (editor.brush.mode === "smooth") return "smooth";
  if (cultural) return editor.brush.delta === 0 ? "erase" : "presence";
  return editor.brush.delta < 0 ? "lower" : "raise";
}
function BrushControls({ editor, cultural }: { editor: EditorState; cultural: boolean }) {
  return (
    <>
      <label>
        Brush action
        <select
          value={brushAction(editor, cultural)}
          onChange={(event) =>
            editor.setBrush({
              ...editor.brush,
              ...actions[event.target.value as keyof typeof actions],
            })
          }
        >
          {cultural ? (
            <>
              <option value="presence">Paint presence</option>
              <option value="erase">Erase presence</option>
            </>
          ) : (
            <>
              <option value="raise">Raise values</option>
              <option value="lower">Lower values</option>
              <option value="smooth">Smooth values</option>
            </>
          )}
        </select>
      </label>
      <label>
        Brush radius · m
        <input
          type="number"
          min=".01"
          step="any"
          value={editor.brush.radius}
          onChange={(event) =>
            editor.setBrush({ ...editor.brush, radius: Number(event.target.value) })
          }
        />
      </label>
      {!cultural && editor.brush.mode !== "smooth" && (
        <label>
          Change per stroke
          <input
            type="number"
            step="any"
            value={editor.brush.delta}
            onChange={(event) =>
              editor.setBrush({ ...editor.brush, delta: Number(event.target.value) })
            }
          />
        </label>
      )}
    </>
  );
}

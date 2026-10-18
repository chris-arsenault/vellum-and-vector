import { useQuery } from "@tanstack/react-query";
import type { World, LayerStyle } from "./types";
import type { EditorState } from "./useEditor";

export function LayerPanel({ world, editor }: { world: World; editor: EditorState }) {
  const channels = useChannels(world);
  function update(id: string, changes: Record<string, unknown>) {
    editor.setStyles(editor.styles.map((s) => (s.layerId === id ? { ...s, ...changes } : s)));
  }
  const styles = editor.styles.concat(
    Object.values(world.layers)
      .filter((l) => !editor.styles.some((s) => s.layerId === l.id))
      .map((l) => ({ layerId: l.id, visible: true, opacity: 0.8, color: l.color, minScale: 0 }))
  );
  return (
    <div className="layer-panel">
      <div className="section-title">WORLD LAYERS</div>
      <label className="field-channel">
        Field visualization
        <select value={editor.channel} onChange={(event) => editor.setChannel(event.target.value)}>
          {[...new Set(["elevation", ...(channels.data ?? [])])].map((channel) => (
            <option key={channel} value={channel}>
              {labelChannel(world, channel)}
            </option>
          ))}
        </select>
      </label>
      {styles.map((style, index) => (
        <LayerRow
          key={style.layerId}
          presentation={style}
          index={index}
          styles={styles}
          world={world}
          editor={editor}
          update={update}
        />
      ))}
      <button
        className="secondary"
        onClick={() =>
          editor.execute("setView", {
            id: crypto.randomUUID(),
            name: "Custom composition",
            areaId: editor.area.id,
            layers: styles,
          })
        }
      >
        Save map view
      </button>
      {world.views.map((view) => (
        <button
          className="quiet"
          key={view.id}
          onClick={() => {
            editor.enter(view.areaId);
            editor.setStyles(view.layers);
          }}
        >
          {view.name}
        </button>
      ))}
    </div>
  );
}
function useChannels(world: World) {
  return useQuery({
    queryKey: ["channels", world.id, world.fields.map((f) => f.id).join(",")],
    queryFn: async () =>
      (
        await Promise.all(
          world.fields.map((f) => (f.channels ? Promise.resolve(f.channels) : Promise.resolve([])))
        )
      )
        .flat()
        .filter((channel) => !channel.startsWith("magicApplied:")),
  });
}
function LayerRow({
  presentation,
  index,
  styles,
  world,
  editor,
  update,
}: {
  presentation: LayerStyle;
  index: number;
  styles: LayerStyle[];
  world: World;
  editor: EditorState;
  update: (id: string, changes: Record<string, unknown>) => void;
}) {
  const style = presentation;
  return (
    <div className="layer-row">
      <label className="check">
        <input
          type="checkbox"
          checked={style.visible}
          onChange={(event) => update(style.layerId, { visible: event.target.checked })}
        />
        {world.layers[style.layerId].name}
      </label>
      <small>{editor.area.layers[style.layerId] ?? "inherited / unmaterialized"}</small>
      <div className="layer-settings">
        <input
          aria-label={`${style.layerId} opacity`}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={style.opacity}
          onChange={(event) => update(style.layerId, { opacity: Number(event.target.value) })}
        />
        <input
          aria-label={`${style.layerId} color`}
          type="color"
          value={style.color}
          onChange={(event) => update(style.layerId, { color: event.target.value })}
        />
        <button
          className="quiet"
          disabled={index === 0}
          title="Move layer up"
          onClick={() => {
            const next = [...styles];
            [next[index - 1], next[index]] = [next[index], next[index - 1]];
            editor.setStyles(next);
          }}
        >
          ↑
        </button>
      </div>
      <LayerDetails presentation={style} update={update} />
    </div>
  );
}
function LayerDetails({
  presentation: style,
  update,
}: {
  presentation: LayerStyle;
  update: (id: string, changes: Record<string, unknown>) => void;
}) {
  return (
    <details>
      <summary>Labels and filter</summary>
      <label className="check">
        <input
          type="checkbox"
          checked={style.labels ?? false}
          onChange={(event) => update(style.layerId, { labels: event.target.checked })}
        />
        Feature labels
      </label>
      <label>
        Attribute or name contains
        <input
          value={style.filter ?? ""}
          onChange={(event) => update(style.layerId, { filter: event.target.value })}
        />
      </label>
      <label>
        Minimum metres per pixel
        <input
          type="number"
          min="0"
          step="any"
          value={style.minScale}
          onChange={(event) => update(style.layerId, { minScale: Number(event.target.value) })}
        />
      </label>
    </details>
  );
}
function labelChannel(world: World, channel: string) {
  const [kind, id] = channel.split(":");
  return id ? `${kind} · ${world.entities[id]?.name ?? id.slice(0, 8)}` : kind;
}

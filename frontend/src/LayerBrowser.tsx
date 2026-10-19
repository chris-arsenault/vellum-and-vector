import { useEffect, useRef, useState } from "react";
import LayerSwitcher from "ol-ext/control/LayerSwitcher.js";
import type BaseLayer from "ol/layer/Base.js";
import type LayerGroup from "ol/layer/Group.js";
import type { EditorState } from "./useEditor";
import { defaultFieldStyle } from "./rasterPresentation";
import { applyMapUpdate } from "./mapEngine";

function readControl(editor: EditorState, layer: BaseLayer) {
  const engine = editor.mapEngine!;
  if (layer.get("baseLayer")) {
    const base = engine.image
      .getLayers()
      .getArray()
      .find((item) => item.getVisible());
    if (base) editor.setRasterView((view) => ({ ...view, base: base.get("key") }));
  } else if (layer.get("layerId")) {
    editor.setStyles(
      editor.styles.map((style) =>
        style.layerId === layer.get("layerId")
          ? { ...style, visible: layer.getVisible(), opacity: layer.getOpacity() }
          : style
      )
    );
  } else if (layer.get("channel")) {
    const channel = layer.get("channel");
    editor.setRasterView((view) => ({
      ...view,
      fields: engine.overlay
        .getLayers()
        .getArray()
        .slice()
        .reverse()
        .map((item) => {
          const field = view.fields.find((field) => field.channel === item.get("channel")) ?? {
            ...defaultFieldStyle(item.get("channel")),
            visible: false,
          };
          return field.channel === channel
            ? { ...field, visible: layer.getVisible(), opacity: layer.getOpacity() }
            : field;
        }),
    }));
  }
}
function readOrder(editor: EditorState) {
  const engine = editor.mapEngine!;
  editor.setStyles(
    engine.vectors
      .getLayers()
      .getArray()
      .slice()
      .reverse()
      .map((layer) => editor.styles.find((style) => style.layerId === layer.get("layerId"))!)
  );
  editor.setRasterView((view) => ({
    ...view,
    fields: engine.overlay
      .getLayers()
      .getArray()
      .slice()
      .reverse()
      .map(
        (layer) =>
          view.fields.find((field) => field.channel === layer.get("channel")) ?? {
            ...defaultFieldStyle(layer.get("channel")),
            visible: layer.getVisible(),
          }
      ),
  }));
}
export function LayerBrowser({
  editor,
  edit,
}: {
  editor: EditorState;
  edit: (target: string) => void;
}) {
  const targets = useRef<(HTMLDivElement | null)[]>([]);
  const current = useRef({ editor, edit });
  const [search, setSearch] = useState("");
  useEffect(() => {
    current.current = { editor, edit };
  }, [editor, edit]);
  useEffect(() => {
    const engine = editor.mapEngine;
    if (!engine) return;
    const controls = [engine.image, engine.overlay, engine.vectors].map((group, index) => {
      const control = makeControl(targets.current[index]!, group, () => current.current);
      engine.map.addControl(control);
      return control;
    });
    return () =>
      controls.forEach((control) => {
        engine.map.removeControl(control);
        control.dispose();
      });
  }, [editor.mapEngine]);
  useEffect(() => {
    const engine = editor.mapEngine;
    if (!engine) return;
    for (const group of [engine.vectors, engine.overlay])
      for (const layer of group.getLayers().getArray())
        layer.set(
          "displayInLayerSwitcher",
          String(layer.get("title")).toLowerCase().includes(search.toLowerCase())
        );
  }, [editor.mapEngine, editor.raster.data, editor.styles, search]);
  return (
    <section className="layer-browser" aria-label="Map layers">
      <label>
        Search layers
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {["Base maps", "Field overlays", "Features"].map((name, index) => (
        <details key={name} open>
          <summary>{name}</summary>
          <div
            ref={(element) => {
              targets.current[index] = element;
            }}
          />
        </details>
      ))}
      <p className="hint">
        Drag to reorder. Focus a checkbox and use ← / → for opacity. The style button edits symbols
        or field colors.
      </p>
    </section>
  );
}
function makeControl(
  target: HTMLElement,
  group: LayerGroup,
  current: () => { editor: EditorState; edit: (target: string) => void }
) {
  const engine = current().editor.mapEngine!;
  const rows = new WeakMap<BaseLayer, HTMLLIElement>();
  const control = new LayerSwitcher({
    target,
    layerGroup: group,
    reordering: group !== engine.image,
    show_progress: true,
    oninfo: (layer) =>
      current().edit(
        layer.get("layerId")
          ? `vector:${layer.get("layerId")}`
          : layer.get("channel")
            ? `field:${layer.get("channel")}`
            : `base:${layer.get("key")}`
      ),
  });
  const read = (event: { layer: BaseLayer }) => {
    if (!engine.sync.applying)
      applyMapUpdate(engine, () => readControl(current().editor, event.layer));
  };
  control.on("layer:visible", read);
  control.on("layer:opacity", (event) => {
    const label = rows.get(event.layer)?.querySelector(".layerswitcher-opacity-label");
    if (label) label.textContent = String(Math.round(event.layer.getOpacity() * 100));
    read(event);
  });
  control.on("reorder-end", () => readOrder(current().editor));
  control.on("drawlist", (event) => {
    rows.set(event.layer, event.li);
    accessibleRow(event.li, event.layer);
  });
  return control;
}
function accessibleRow(row: HTMLLIElement, layer: BaseLayer) {
  const visibility = row.querySelector<HTMLInputElement>(":scope > .li-content > input");
  visibility?.setAttribute(
    "aria-label",
    `${layer.get("baseLayer") ? "" : "Show "}${layer.get("title")}`
  );
  const info = row.querySelector<HTMLElement>(".layerInfo");
  if (!info) return;
  info.setAttribute("role", "button");
  info.setAttribute("aria-label", `Style ${layer.get("title")}`);
  info.title = "Edit style";
  info.tabIndex = 0;
  info.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      info.click();
    }
  });
}

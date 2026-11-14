import { useId, useState, useRef, useEffect } from "react";
import type { FieldStyle } from "./types";
import { FeatureThemeControls } from "./FeatureThemeControls";
import { OverlayCatalogue } from "./OverlayCatalogue";
import { OverlayStackControls, type OverlayActions } from "./OverlayStackControls";
import { PublishedVectorControls } from "./PublishedVectorControls";
import { PublishedTerrain } from "./PublishedAppearance";
import { defaultFieldStyle } from "./rasterDefaults";
import { publishedStyles } from "./publishedAppearance";
import {
  publishedOverlayChoices,
  publishedRasterDescription,
  publishedSocialLayers,
  publishedThemeTypes,
  type PublishedStyleContext,
} from "./publishedStyling";

export function PublishedLayerPanel(context: PublishedStyleContext) {
  const [target, setTarget] = useState("");
  const { map, value, change } = context;
  const appearance = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!target) return;
    appearance.current?.scrollIntoView({ block: "nearest" });
    appearance.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [target]);
  const vector = target.startsWith("vector:") ? target.slice(7) : "";
  return (
    <div className="layer-panel">
      {value.drawing.mode === "raster" && (
        <label className="view-preset">
          Layer preset
          <select
            aria-label="View preset"
            value=""
            onChange={(event) => applyPreset(context, event.target.value)}
          >
            <option value="" disabled>
              Apply a preset…
            </option>
            {["physical", "political", "cultural", "magical", "infrastructure"].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      )}
      <section className="layer-browser" aria-label="Map layers">
        {value.drawing.mode === "raster" ? (
          <PublishedOverlays context={context} target={target} edit={setTarget} />
        ) : (
          <PublishedSocialFields context={context} />
        )}
        <FeatureThemeControls
          allTypes={publishedThemeTypes(map)}
          styles={value.styles}
          setStyles={(styles) => change({ ...value, styles })}
          edit={setTarget}
          layerName={(id) => map.layers.find((layer) => layer.id === id)!.name}
        />
      </section>
      {target && !target.startsWith("field:") && (
        <div className="contextual-style" ref={appearance}>
          <button className="quiet" onClick={() => setTarget("")}>
            ← Back to map layers
          </button>
          {target.startsWith("base:") && <PublishedTerrain context={context} />}
          {vector && <PublishedVectorControls key={vector} context={context} layerId={vector} />}
        </div>
      )}
    </div>
  );
}
function overlayActions(
  context: PublishedStyleContext,
  edit: (id: string) => void,
  target: string
): OverlayActions {
  const { value, change } = context;
  const write = (fields: FieldStyle[]) => change({ ...value, raster: { ...value.raster, fields } });
  return {
    update: (channel, changes) =>
      write(
        value.raster.fields.some((field) => field.channel === channel)
          ? value.raster.fields.map((field) =>
              field.channel === channel ? { ...field, ...changes } : field
            )
          : [...value.raster.fields, { ...defaultFieldStyle(channel), ...changes }]
      ),
    remove: (channel) => {
      write(value.raster.fields.filter((field) => field.channel !== channel));
      if (target === `field:${channel}`) edit("");
    },
    reorder: (channel, direction) => {
      const fields = [...value.raster.fields],
        at = fields.findIndex((field) => field.channel === channel),
        next = at + direction;
      if (at < 0 || next < 0 || next >= fields.length) return;
      [fields[at], fields[next]] = [fields[next], fields[at]];
      write(fields);
    },
  };
}
function PublishedOverlays({
  context,
  target,
  edit,
}: {
  context: PublishedStyleContext;
  target: string;
  edit(id: string): void;
}) {
  const id = useId(),
    actions = overlayActions(context, edit, target);
  const choices = publishedOverlayChoices(context.map);
  const fields = context.value.raster.fields.filter((field) =>
    choices.some((choice) => choice.id === field.channel)
  );
  return (
    <>
      <div className="layer-section-title">
        <h3>Overlays</h3>
        <button className="quiet" popoverTarget={id}>
          + Add overlay
        </button>
      </div>
      <OverlayCatalogue
        id={id}
        choices={choices}
        fields={fields}
        update={actions.update}
        remove={actions.remove}
      />
      <OverlayStackControls
        fields={fields}
        actions={actions}
        edit={edit}
        target={target}
        descriptions={context.map.layers
          .filter((layer) => layer.source.kind === "raster")
          .map(publishedRasterDescription)}
      />
      {!fields.length && <p className="empty-overlays">No overlays</p>}
    </>
  );
}
function PublishedSocialFields({
  context: { map, value, change },
}: {
  context: PublishedStyleContext;
}) {
  const layers = publishedSocialLayers(map),
    selected = value.drawing.fields;
  return (
    <details className="drawn-fields">
      <summary>Social distributions</summary>
      <p className="hint">
        Each field is independent. Hatch length shows prevalence; population uses proportional dots.
      </p>
      {!layers.length && <p className="hint">No social distribution fields on this source map.</p>}
      {layers.map((layer) => (
        <label key={layer.id}>
          <input
            type="checkbox"
            checked={selected.includes(layer.id)}
            onChange={(event) =>
              change({
                ...value,
                drawing: {
                  ...value.drawing,
                  fields: event.target.checked
                    ? [...selected, layer.id]
                    : selected.filter((id) => id !== layer.id),
                },
              })
            }
          />
          {layer.name}
        </label>
      ))}
    </details>
  );
}
function applyPreset({ map, value, change }: PublishedStyleContext, preset: string) {
  const overlay =
    preset === "cultural"
      ? map.layers.find((layer) => layer.id.startsWith("raster:culture:"))
      : preset === "magical"
        ? (map.layers.find((layer) => layer.id === "raster:finalSurface") ??
          map.layers.find((layer) => layer.id.startsWith("raster:magic:")))
        : undefined;
  change({
    ...value,
    styles: publishedStyles(map, preset),
    raster: { ...value.raster, fields: overlay ? [defaultFieldStyle(overlay.id)] : [] },
  });
}

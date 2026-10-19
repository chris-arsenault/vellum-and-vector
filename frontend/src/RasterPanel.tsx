import { useId } from "react";
import { naturalSurfaceNames, physicalMaterialNames } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { FieldStyle, Raster, RasterPresentation, World } from "./types";
import {
  defaultFieldStyle,
  fieldLabel,
  fieldRange,
  legendValue,
  palettes,
} from "./rasterPresentation";

export function RasterPanel({
  world,
  editor,
  target,
  edit,
}: {
  world: World;
  editor: EditorState;
  target: string;
  edit: (target: string) => void;
}) {
  const data = editor.raster.data ?? [];
  const channels = [...new Set(data.map((raster) => raster.channel))];
  const channel = target.startsWith("field:") ? target.slice(6) : "";
  function update(changes: Partial<RasterPresentation>) {
    editor.setRasterView((view) => ({ ...view, ...changes }));
  }
  return (
    <section className="raster-panel" aria-label="Raster appearance">
      <details open={target.startsWith("base:")}>
        <summary>Terrain shading and contours</summary>
        <TerrainControls view={editor.rasterView} update={update} />
      </details>
      <label>
        Field style
        <select
          aria-label="Field style"
          value={channel}
          onChange={(event) => edit(`field:${event.target.value}`)}
        >
          <option value="">Use a layer's style button</option>
          {channels.map((key) => (
            <option key={key} value={key}>
              {fieldLabel(world, key)}
            </option>
          ))}
        </select>
      </label>
      {channel && <FieldControls key={channel} world={world} editor={editor} channel={channel} />}
      <div className="field-legends" aria-label="Visible field legends">
        {editor.rasterView.fields
          .filter((field) => field.visible)
          .map((field) => {
            const parts = data.filter((raster) => raster.channel === field.channel);
            return parts.length ? (
              <FieldLegend key={field.channel} world={world} field={field} data={parts} />
            ) : null;
          })}
      </div>
      {!channels.length && <p className="hint">Generate or author fields to add overlays.</p>}
    </section>
  );
}
function TerrainControls({
  view,
  update,
}: {
  view: RasterPresentation;
  update: (changes: Partial<RasterPresentation>) => void;
}) {
  return (
    <>
      <label>
        Sun azimuth · °
        <input
          type="range"
          min="0"
          max="360"
          value={view.sunAzimuth}
          onChange={(event) => update({ sunAzimuth: Number(event.target.value) })}
        />
        <output>{view.sunAzimuth}°</output>
      </label>
      <label>
        Sun elevation · °
        <input
          type="range"
          min="1"
          max="90"
          value={view.sunElevation}
          onChange={(event) => update({ sunElevation: Number(event.target.value) })}
        />
      </label>
      <label>
        Vertical exaggeration
        <input
          type="range"
          min="0"
          max="20"
          step="0.1"
          value={view.exaggeration}
          onChange={(event) => update({ exaggeration: Number(event.target.value) })}
        />
        <output>{view.exaggeration}×</output>
      </label>
      <label>
        Contour interval · m
        <input
          type="number"
          min="0.01"
          step="any"
          value={view.contourInterval}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value > 0) update({ contourInterval: value });
          }}
        />
      </label>
    </>
  );
}
function FieldControls({
  world,
  editor,
  channel,
}: {
  world: World;
  editor: EditorState;
  channel: string;
}) {
  const field = editor.rasterView.fields.find((field) => field.channel === channel) ?? {
    ...defaultFieldStyle(channel),
    visible: false,
  };
  function update(changes: Partial<FieldStyle>) {
    editor.setRasterView((view) => ({
      ...view,
      fields: view.fields.some((item) => item.channel === channel)
        ? view.fields.map((item) => (item.channel === channel ? { ...item, ...changes } : item))
        : [...view.fields, { ...field, ...changes }],
    }));
  }
  const data = (editor.raster.data ?? []).filter((part) => part.channel === channel);
  return (
    <fieldset className="field-style">
      <legend>{fieldLabel(world, channel)}</legend>
      <label>
        Color ramp
        <select
          aria-label="Color ramp"
          value={field.palette}
          onChange={(event) => update({ palette: event.target.value as FieldStyle["palette"] })}
        >
          {Object.keys(palettes).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Value scale
        <select
          aria-label="Value scale"
          value={field.scale}
          onChange={(event) => update({ scale: event.target.value as FieldStyle["scale"] })}
        >
          <option value="linear">Linear</option>
          <option value="log">Signed logarithmic</option>
        </select>
      </label>
      <p className="hint">
        Logarithmic scaling retains zero and negative values. Missing data is transparent.
      </p>
      <RangeControls key={JSON.stringify(field.range)} field={field} data={data} update={update} />
      <FieldLegend world={world} field={field} data={data} />
      <SurfaceCodes world={world} channel={channel} />
    </fieldset>
  );
}
function SurfaceCodes({ world, channel }: { world: World; channel: string }) {
  const names: Record<number, string> = {};
  if (channel === "physicalMaterial") physicalMaterialNames.forEach((name, i) => (names[i] = name));
  if (["naturalSurface", "finalSurface"].includes(channel))
    naturalSurfaceNames.forEach((name, i) => (names[i] = name));
  if (channel === "finalSurface") {
    let code = 100;
    for (const system of world.magicSystems?.filter((system) => system.enabled) ?? [])
      for (const rule of system.features) names[code++] = `${system.name} · ${rule.name}`;
  }
  if (!Object.keys(names).length) return null;
  return (
    <details>
      <summary>Surface codes</summary>
      <dl>
        {Object.entries(names).map(([code, name]) => (
          <div key={code}>
            <dt>{code}</dt>
            <dd>{name}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function RangeControls({
  field,
  data,
  update,
}: {
  field: FieldStyle;
  data: Raster[];
  update: (changes: Partial<FieldStyle>) => void;
}) {
  const range = fieldRange(data, field);
  return (
    <form
      onInput={(event) => {
        const maximum = event.currentTarget.elements.namedItem("maximum") as HTMLInputElement;
        maximum.setCustomValidity("");
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const input = new FormData(event.currentTarget);
        const min = Number(input.get("minimum")),
          max = Number(input.get("maximum"));
        const maximum = event.currentTarget.elements.namedItem("maximum") as HTMLInputElement;
        maximum.setCustomValidity(max > min ? "" : "Maximum must exceed minimum.");
        if (event.currentTarget.reportValidity()) update({ range: [min, max] });
      }}
    >
      <label>
        Range minimum
        <input name="minimum" type="number" step="any" required defaultValue={range[0]} />
      </label>
      <label>
        Range maximum
        <input name="maximum" type="number" step="any" required defaultValue={range[1]} />
      </label>
      <button type="submit">Apply range</button>
      <button type="button" onClick={() => update({ range: null })}>
        Use data range
      </button>
    </form>
  );
}
export function FieldLegend({
  world,
  field,
  data,
}: {
  world: World;
  field: FieldStyle;
  data: Raster[];
}) {
  const id = useId();
  const range = fieldRange(data, field);
  const unit = data[0]?.field.units[field.channel] ?? "";
  const number = (value: number) => Number(value.toPrecision(4)).toLocaleString();
  return (
    <figure className="field-legend">
      <figcaption>
        {fieldLabel(world, field.channel)} <small>{unit}</small>
      </figcaption>
      <svg viewBox="0 0 200 12" role="img" aria-label={`${field.palette} color ramp`}>
        <defs>
          <linearGradient id={id}>
            {palettes[field.palette].map((color, i, all) => (
              <stop key={color} offset={i / (all.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
        <rect width="200" height="12" fill={`url(#${id})`} />
      </svg>
      <div className="legend-values">
        <span>{number(range[0])}</span>
        <span>{number(legendValue(0.5, range, field.scale))}</span>
        <span>{number(range[1])}</span>
      </div>
    </figure>
  );
}

import { useId } from "react";
import { physicalMaterialNames, type SurfaceCategory } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { FieldStyle, Raster, RasterPresentation, World } from "./types";
import {
  categoryPalette,
  defaultFieldStyle,
  fieldLabel,
  fieldRange,
  legendValue,
  palettes,
  rasterCategories,
  surfacePalette,
} from "./rasterPresentation";

export function RasterPanel({
  world,
  editor,
  target,
}: {
  world: World;
  editor: EditorState;
  target: string;
}) {
  const channel = target.startsWith("field:") ? target.slice(6) : "";
  function update(changes: Partial<RasterPresentation>) {
    editor.setRasterView((view) => ({ ...view, ...changes }));
  }
  if (!channel && !target.startsWith("base:")) return null;
  return (
    <section className="raster-panel" aria-label="Raster appearance">
      {!channel && (
        <>
          <h3>Terrain appearance</h3>
          <TerrainControls view={editor.rasterView} update={update} />
          {editor.rasterView.base === "surface" && (
            <SurfaceLegend world={world} base={editor.baseRaster.data ?? []} />
          )}
        </>
      )}
      {channel && <FieldControls key={channel} world={world} editor={editor} channel={channel} />}
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
        Minimum contour interval · m
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
      <p className="hint">
        Contours become coarser as you zoom out. Every fifth line is emphasized.
      </p>
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
  if (categoryPalette(world, channel))
    return (
      <fieldset className="field-style">
        <legend>{fieldLabel(world, channel)}</legend>
        {channel === "biome" && (
          <p className="hint">
            Biomes describe living cover independently of landform. Tree cover, wetland cover and
            animal biomass can be inspected as separate fields under Biomes and life.
          </p>
        )}
        <FieldLegend world={world} field={field} data={data} />
        <SurfaceCodes world={world} channel={channel} />
      </fieldset>
    );
  return (
    <fieldset className="field-style">
      <legend>{fieldLabel(world, channel)}</legend>
      <div className="field-controls">
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
            title="Signed logarithmic scaling retains zero and negative values. Missing data is transparent."
            value={field.scale}
            onChange={(event) => update({ scale: event.target.value as FieldStyle["scale"] })}
          >
            <option value="linear">Linear</option>
            <option value="log">Signed logarithmic</option>
          </select>
        </label>
      </div>
      <RangeControls key={JSON.stringify(field.range)} field={field} data={data} update={update} />
      <FieldLegend world={world} field={field} data={data} />
      <SurfaceCodes world={world} channel={channel} />
    </fieldset>
  );
}
/** The full code catalogue, including classes absent from the current map. */
function SurfaceCodes({ world, channel }: { world: World; channel: string }) {
  const names: Record<number, string> = {};
  if (channel === "physicalMaterial") physicalMaterialNames.forEach((name, i) => (names[i] = name));
  if (["naturalSurface", "finalSurface"].includes(channel))
    for (const item of categoryPalette(world, channel) ?? []) names[item.code] = item.name;
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
      className="range-controls"
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
      <div className="range-actions">
        <button type="submit">Apply range</button>
        <button type="button" onClick={() => update({ range: null })}>
          Use data range
        </button>
      </div>
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
  const classes = categoryPalette(world, field.channel);
  if (classes)
    return (
      <CategoryLegend title={fieldLabel(world, field.channel)} classes={classes} data={data} />
    );
  const range = fieldRange(data, field);
  const unit = data[0]?.field.units[field.channel] ?? "";
  const number = (value: number) => Number(value.toPrecision(4)).toLocaleString();
  return (
    <figure className="field-legend">
      <figcaption>
        {fieldLabel(world, field.channel)} <small>{unit}</small>
      </figcaption>
      <svg
        viewBox="0 0 200 12"
        role="img"
        aria-label={`${field.palette} color ramp`}
        preserveAspectRatio="none"
      >
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
/** Only classes present in the displayed rasters are listed. */
function CategoryLegend({
  title,
  classes,
  data,
}: {
  title: string;
  classes: SurfaceCategory[];
  data: Raster[];
}) {
  const present = new Set(rasterCategories(data));
  return (
    <figure className="field-legend categorical-legend">
      <figcaption>{title}</figcaption>
      <ul>
        {classes.map((item) =>
          present.has(item.code) ? (
            <li key={item.code}>
              <svg width="12" height="12" aria-hidden="true">
                <rect width="12" height="12" fill={item.color} />
              </svg>{" "}
              {item.name}
            </li>
          ) : null
        )}
      </ul>
    </figure>
  );
}
/** The surface base legend reads the terrain rasters' surface companions. */
export function SurfaceLegend({ world, base }: { world: World; base: Raster[] }) {
  const data = base
    .filter((raster) => raster.surface?.channels.finalSurface)
    .map((raster) => ({ ...raster, field: raster.surface!, channel: "finalSurface" }));
  if (!data.length) return null;
  return <CategoryLegend title="Surface" classes={surfacePalette(world)} data={data} />;
}

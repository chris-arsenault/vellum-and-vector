import { useId } from "react";
import type { Category, DisplayUnit } from "@atlas/map";
import type { FieldStyle, RasterPresentation } from "./types";
import { palettes, scaledValue } from "./rasterColors";

export interface RasterDescription {
  name: string;
  channel: string;
  display: DisplayUnit;
  range: [number, number];
  categories: Category[];
}
const fieldRange = (data: RasterDescription, style: FieldStyle) => style.range ?? data.range;
function legendValue(t: number, range: number[], scale: FieldStyle["scale"]) {
  const value = scaledValue(range[0], scale) * (1 - t) + scaledValue(range[1], scale) * t;
  return scale === "log" ? Math.sign(value) * Math.expm1(Math.abs(value)) : value;
}
export function TerrainControls({
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
export function FieldControls({
  data,
  field,
  update,
}: {
  data: RasterDescription;
  field: FieldStyle;
  update(changes: Partial<FieldStyle>): void;
}) {
  if (data.categories.some((category) => category.color !== null))
    return (
      <fieldset className="field-style">
        <legend>{data.name}</legend>
        {["BiomeCodes", "raster:BiomeCodes"].includes(data.channel) && (
          <p className="hint">
            Biomes describe living cover independently of landform. Tree cover, wetland cover and
            animal biomass can be inspected as separate fields under Biomes and life.
          </p>
        )}
        <FieldLegend field={field} data={data} />
        <SurfaceCodes data={data} />
      </fieldset>
    );
  return (
    <fieldset className="field-style">
      <legend>{data.name}</legend>
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
      <FieldLegend field={field} data={data} />
      <SurfaceCodes data={data} />
    </fieldset>
  );
}
/** The full code catalogue, including classes absent from the current map. */
function SurfaceCodes({ data }: { data: RasterDescription }) {
  const names = Object.fromEntries(
    data.categories.map((category) => [category.value, category.label])
  );
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
  data: RasterDescription;
  update: (changes: Partial<FieldStyle>) => void;
}) {
  const { unit, factor } = data.display,
    range = fieldRange(data, field).map((value) => Number((value * factor).toPrecision(6)));
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
        if (event.currentTarget.reportValidity()) update({ range: [min / factor, max / factor] });
      }}
    >
      <label>
        Range minimum{unit && ` · ${unit}`}
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
export function FieldLegend({ field, data }: { field: FieldStyle; data: RasterDescription }) {
  const id = useId();
  if (data.categories.some((category) => category.color !== null))
    return <CategoryLegend title={data.name} classes={data.categories} />;
  const range = fieldRange(data, field);
  const { unit, factor } = data.display;
  const number = (value: number) => Number((value * factor).toPrecision(4)).toLocaleString();
  return (
    <figure className="field-legend">
      <figcaption>
        {data.name} <small>{unit}</small>
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
export function CategoryLegend({ title, classes }: { title: string; classes: Category[] }) {
  return (
    <figure className="field-legend categorical-legend">
      <figcaption>{title}</figcaption>
      <ul>
        {classes.map((item) =>
          item.present ? (
            <li key={item.value}>
              <svg width="12" height="12" aria-hidden="true">
                <rect width="12" height="12" fill={item.color ?? undefined} />
              </svg>{" "}
              {item.label}
            </li>
          ) : null
        )}
      </ul>
    </figure>
  );
}

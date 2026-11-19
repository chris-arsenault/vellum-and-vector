import { useState } from "react";
import {
  mapSpace,
  type BandValue,
  type Inspection,
  type InspectionSection,
  type MapDescriptor,
  type MapFeature,
  type MapSample,
} from "@atlas/map";
import { Facts } from "./InspectionSurface";
import { inspectionFact as fact, inspectionWords as words } from "./inspectionText";
import "./cellInspection.css";

export function PublishedCellInspection({
  map,
  inspection,
}: {
  map: MapDescriptor;
  inspection: Inspection | null;
}) {
  return (
    <section className="cell-inspection">
      <p className="eyebrow">WHAT IS HERE</p>
      <h2>Inspect cell</h2>
      <p>Click the map to see what is at that place and why it looks the way it does.</p>
      {inspection && <PublishedCellResult map={map} data={inspection} />}
    </section>
  );
}
function PublishedCellResult({ map, data }: { map: MapDescriptor; data: Inspection }) {
  const [filter, setFilter] = useState("");
  const factor = mapSpace(map, data.spaceId).metresPerUnit;
  const sections = data.samples.flatMap((sample) => sample.sections);
  return (
    <>
      <p>
        Clicked {(data.position[0] * factor).toFixed(2)}, {(data.position[1] * factor).toFixed(2)} m
      </p>
      {!data.values.length && !data.features.length && (
        <p>No stored map facts at this position on this map.</p>
      )}
      <SurfaceExplanation map={map} data={data} />
      <section className="cell-features">
        <h3>Here ({data.features.length})</h3>
        {!data.features.length && <p>No mapped feature covers or passes through this cell.</p>}
        {data.features.map((feature) => (
          <PublishedFeatureCard key={feature.id} map={map} feature={feature} />
        ))}
      </section>
      {sections.map((section) => (
        <PublishedFactsTable key={section.id} section={section} />
      ))}
      <details className="cell-stored">
        <summary>Stored values ({data.values.length} channels)</summary>
        <label>
          Filter channels
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="water, tree cover, elevation…"
          />
        </label>
        {data.samples.map((sample) => (
          <SampleCell key={sample.id} sample={sample} factor={factor} />
        ))}
        <StoredValues values={data.values} filter={filter} />
      </details>
      {!!data.causes.length && (
        <details>
          <summary>Completed geographic history</summary>
          {data.causes.map((entry) => (
            <article key={entry.id}>
              <h4>{entry.title}</h4>
              <p>{entry.description}</p>
            </article>
          ))}
        </details>
      )}
    </>
  );
}
function SurfaceExplanation({ map, data }: { map: MapDescriptor; data: Inspection }) {
  return (
    <section className="cell-explanation">
      <h3>Why it looks like this</h3>
      <ul className="cell-classes">
        {[
          ["finalSurface", "Map colour"],
          ["secondSurface", "Blended with"],
          ["BiomeCodes", "Biome"],
        ].map(([channel, label]) => {
          const layer = map.layers.find((layer) => layer.id === `raster:${channel}`);
          if (!layer || layer.source.kind === "vector") return null;
          const value = data.values.find((value) => value.layerId === layer.id);
          const category = layer.source.data.bands
            .find((band) => band.id === value?.bandId)
            ?.categories.find((category) => category.value === value?.value);
          if (!category) return null;
          return (
            <li key={channel}>
              <svg className="cell-swatch" viewBox="0 0 12 12" aria-hidden="true">
                <rect width="12" height="12" fill={category.color ?? undefined} />
              </svg>
              <strong>{label}:</strong> {category.label}
              {category.surface?.system && (
                <span className="cell-cause">
                  {" "}
                  — a magic class
                  {category.surface.systemName ? ` of ${category.surface.systemName}` : ""}; see the
                  magic area below
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function PublishedFeatureCard({ map, feature }: { map: MapDescriptor; feature: MapFeature }) {
  const attributes = Object.entries(feature.attributes).filter(([, value]) =>
    ["number", "boolean", "string"].includes(typeof value)
  );
  const shape = feature.geometry.type.includes("Point")
    ? "on this cell"
    : feature.geometry.type.includes("Line")
      ? "through this cell"
      : "covers this cell";
  return (
    <article className="cell-feature">
      <h4>{feature.name}</h4>
      <p className="eyebrow">
        {words(feature.kind)} ·{" "}
        {map.layers.find((layer) => layer.id === feature.layerId)?.name ?? feature.layerId} ·{" "}
        {shape}
      </p>
      {!!attributes.length && (
        <Facts
          items={attributes.map(([key, value]) => [
            words(key),
            typeof value === "string" ? words(value) : fact(value),
          ])}
        />
      )}
      {!!feature.causes.length && (
        <ul className="cell-causes">
          {feature.causes.map((cause, index) => (
            <li key={index}>{cause}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
export function PublishedFactsTable({ section }: { section: InspectionSection }) {
  const columns = [...new Set(section.records.flatMap((record) => Object.keys(record)))];
  return (
    <table className="cell-column">
      <caption>{section.title}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {section.records.map((record, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column}>{fact(record[column])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function SampleCell({ sample, factor }: { sample: MapSample; factor: number }) {
  return (
    <section className="cell-data">
      <h3>Sample {sample.id}</h3>
      <Facts
        items={[
          [
            "Center (m)",
            sample.center
              .slice(0, 2)
              .map((value) => (value * factor).toFixed(2))
              .join(", "),
          ],
          [
            "Bounds (m)",
            sample.window.bounds.map((value) => (value * factor).toFixed(2)).join(", "),
          ],
          ["Area (m²)", String(sample.measure)],
          ["Active", sample.active ? "Yes" : "No"],
        ]}
      />
    </section>
  );
}
function StoredValues({ values, filter }: { values: BandValue[]; filter: string }) {
  const shown = values.filter((value) =>
    `${value.label} ${value.layerId} ${value.bandId}`.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <table>
      <caption>{values.length} stored channels</caption>
      <thead>
        <tr>
          <th>Channel</th>
          <th>Value</th>
          <th>Unit</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((value) => (
          <tr key={`${value.layerId}:${value.bandId}`}>
            <th scope="row" title={`${value.layerId} · ${value.bandId}`}>
              {value.label}
            </th>
            <td>
              {value.category ? `${String(value.value)} · ${value.category}` : String(value.value)}
            </td>
            <td>{value.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import type { MapDescriptor, MapReader } from "@atlas/map";
import type { Geometry } from "geojson";
import { useQuery } from "@tanstack/react-query";
import type { PublishedFeature } from "./publishedAppearance";
import { PublishedSettlement } from "./PublishedSettlement";
import { SurveyHistory } from "./SurveyComparison";
import { publishedSurveys, readPublishedHistory } from "./publishedHistory";
import { inspectionWords as words, inspectionFact as fact } from "./inspectionText";

export function PublishedFeatureInformation({
  map,
  reader,
  feature,
  select,
  region,
}: {
  map: MapDescriptor;
  reader: MapReader;
  feature: PublishedFeature;
  select: (feature: PublishedFeature) => void;
  region: (geometry?: Geometry) => void;
}) {
  return (
    <section className="feature-information">
      <FeatureLocation map={map} feature={feature} region={region} />
      {feature.kind === "settlement" && (
        <PublishedSettlement map={map} reader={reader} feature={feature} select={select} />
      )}
      <FeatureProperties feature={feature} />
      {feature.kind === "veil:wild" && (
        <PublishedWildHistory key={feature.id} map={map} reader={reader} feature={feature} />
      )}
      <FeatureOrigin feature={feature} />
    </section>
  );
}
function FeatureLocation({
  map,
  feature,
  region,
}: Pick<Parameters<typeof PublishedFeatureInformation>[0], "map" | "feature" | "region">) {
  const footprint = feature.footprint ?? feature.geometry;
  const enclosed = ["Polygon", "MultiPolygon"].includes(footprint.type);
  return (
    <>
      <p className="eyebrow">
        {words(feature.kind)} · {String(feature.catalog.values.state ?? "")}
      </p>
      <h2>{feature.name}</h2>
      <dl>
        <dt>Layer</dt>
        <dd>
          {map.layers.find((layer) => layer.id === feature.mapLayerId)?.name ?? feature.layerId}
        </dd>
        <dt>Map</dt>
        <dd>{map.name}</dd>
        {enclosed && (
          <>
            <dt>Area</dt>
            <dd>{Number(feature.catalog.values.areaKm2).toLocaleString()} km²</dd>
          </>
        )}
      </dl>
      <div className="selection-next">
        <h3>Explore this place in more detail</h3>
        <p>
          {enclosed
            ? "Use this boundary as a region, then refine the geography inside it."
            : "Choose a geographic region around this feature to add finer detail."}
        </p>
        <button className="primary" onClick={() => region(enclosed ? footprint : undefined)}>
          {enclosed ? "Use boundary as region" : "Choose surrounding region"}
        </button>
      </div>
    </>
  );
}
function FeatureOrigin({ feature }: { feature: PublishedFeature }) {
  return (
    <details>
      <summary>Origin and relationships</summary>
      <p>
        {feature.catalog.origin}
        {feature.catalog.mapOnly ? " · local to this map" : ""}
      </p>
      {feature.causes.length > 0 && (
        <ul>
          {feature.causes.map((cause, i) => (
            <li key={i}>{cause}</li>
          ))}
        </ul>
      )}
      {feature.relations.length > 0 ? (
        <ul>
          {feature.relations.map((relation, i) => (
            <li key={i}>
              {words(relation.kind)}: {relation.targetName}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No recorded relationships.</p>
      )}
      <small className="mono">{feature.id}</small>
    </details>
  );
}
function FeatureProperties({ feature }: { feature: PublishedFeature }) {
  const properties = Object.entries(feature.attributes);
  if (!properties.length) return null;
  return (
    <details open>
      <summary>About this feature</summary>
      <dl>
        {properties.map(([key, value]) => (
          <div key={key}>
            <dt>{words(key)}</dt>
            <dd>{fact(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function PublishedWildHistory({
  map,
  reader,
  feature,
}: {
  map: MapDescriptor;
  reader: MapReader;
  feature: PublishedFeature;
}) {
  const history = useQuery({
    queryKey: ["map-history", map.reference],
    queryFn: ({ signal }) => readPublishedHistory(reader, map.reference, signal),
  });
  return (
    <>
      <SurveyHistory
        feature={feature}
        observations={publishedSurveys(history.data ?? [], feature.id)}
      />
      {history.error && <p role="alert">{history.error.message}</p>}
    </>
  );
}

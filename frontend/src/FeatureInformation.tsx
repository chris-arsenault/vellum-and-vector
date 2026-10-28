import { spatial } from "@atlas/domain";
import { SettlementSurface } from "./SettlementSurface";
import type { EditorState } from "./useEditor";
import type { AtlasFeature, World } from "./types";

export function FeatureInformation({ world, editor }: { world: World; editor: EditorState }) {
  const feature = editor.selected!;
  const footprint = feature.footprint ?? feature.geometry;
  const enclosed = ["Polygon", "MultiPolygon"].includes(footprint.type);
  return (
    <section className="feature-information">
      <p className="eyebrow">
        {words(feature.kind)} · {feature.state}
      </p>
      <h2>{feature.name}</h2>
      <dl>
        <dt>Layer</dt>
        <dd>{world.layers[feature.layerId]?.name ?? feature.layerId}</dd>
        <dt>Map</dt>
        <dd>{editor.region?.name ?? editor.area.name}</dd>
        {enclosed && (
          <>
            <dt>Area</dt>
            <dd>{(spatial.area(footprint) / 1e6).toLocaleString()} km²</dd>
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
        <button
          className="primary"
          onClick={() => {
            editor.openRegions();
            if (enclosed) editor.regionDraw(footprint);
          }}
        >
          {enclosed ? "Use boundary as region" : "Choose surrounding region"}
        </button>
      </div>
      {feature.kind === "settlement" && (
        <SettlementSurface
          world={world}
          feature={feature}
          areaId={editor.area.id}
          editor={editor}
        />
      )}
      <FeatureProperties feature={feature} />
      <FeatureOrigin feature={feature} world={world} />
    </section>
  );
}

function FeatureOrigin({ feature, world }: { feature: AtlasFeature; world: World }) {
  return (
    <details>
      <summary>Origin and relationships</summary>
      <p>
        {feature.actor === "generator" ? "Generated geography" : "Authored geography"}
        {feature.mapOnly ? " · local to this map" : ""}
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
              {words(relation.kind)}: {world.entities[relation.targetId]?.name ?? relation.targetId}
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

function FeatureProperties({ feature }: { feature: AtlasFeature }) {
  const properties = Object.entries(feature.attributes);
  if (!properties.length) return null;
  return (
    <details open>
      <summary>About this feature</summary>
      <dl>
        {properties.map(([key, value]) => (
          <div key={key}>
            <dt>{words(key)}</dt>
            <dd>{propertyValue(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function words(text: string) {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}
function propertyValue(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Array.isArray(value)) return value.map(propertyValue).join(", ") || "None";
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${words(key)}: ${propertyValue(item)}`)
      .join("; ");
  return String(value);
}

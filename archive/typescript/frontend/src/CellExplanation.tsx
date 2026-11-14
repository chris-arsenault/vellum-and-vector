import type { World } from "./types";
import type { FieldChannelName } from "@atlas/domain";
import type { CellValue, InspectedFeature } from "./cellInspection";
import { categoryPalette } from "./rasterPresentation";
import { Facts } from "./InspectionSurface";

/** The surface classes that colour the map, strongest first. */
const colourChannels = [
  ["finalSurface", "Map colour"],
  ["secondSurface", "Blended with"],
  ["BiomeCodes", "Biome"],
] as const satisfies readonly (readonly [FieldChannelName, string])[];

/**
 * Why the clicked place looks as it does: the class that colours it (and the magic system
 * behind a magic class), then the features on and around it with their facts and causes.
 */
export function CellExplanation({
  world,
  values,
  features,
}: {
  world: World;
  values: CellValue[];
  features: InspectedFeature[];
}) {
  return (
    <>
      <section className="cell-explanation">
        <h3>Why it looks like this</h3>
        <ul className="cell-classes">
          {colourChannels.map(([channel, label]) => (
            <SurfaceClass
              key={channel}
              world={world}
              label={label}
              values={values}
              channel={channel}
            />
          ))}
        </ul>
      </section>
      <section className="cell-features">
        <h3>Here ({features.length})</h3>
        {!features.length && <p>No mapped feature covers or passes through this cell.</p>}
        {features.map((feature) => (
          <FeatureCard key={feature.id} world={world} feature={feature} />
        ))}
      </section>
    </>
  );
}

function SurfaceClass({
  world,
  label,
  values,
  channel,
}: {
  world: World;
  label: string;
  values: CellValue[];
  channel: string;
}) {
  const value = values.find((value) => value.channel === channel);
  const category = value && categoryPalette(world, channel)?.find((c) => c.code === value.value);
  if (!category) return null;
  const system = category.system && world.magicSystems?.find((s) => s.id === category.system);
  return (
    <li>
      <svg className="cell-swatch" viewBox="0 0 12 12" aria-hidden="true">
        <rect width="12" height="12" fill={category.color} />
      </svg>
      <strong>{label}:</strong> {category.name}
      {category.system && (
        <span className="cell-cause">
          {" "}
          — a magic class{system ? ` of ${system.name}` : ""}; see the magic area below
        </span>
      )}
    </li>
  );
}

function FeatureCard({ world, feature }: { world: World; feature: InspectedFeature }) {
  const layer = world.layers[feature.layerId]?.name ?? feature.layerId;
  return (
    <article className="cell-feature">
      <h4>{feature.name}</h4>
      <p className="eyebrow">
        {words(feature.kind)} · {layer} · {shape(feature.geometryType)}
      </p>
      {feature.attributes.length > 0 && (
        <Facts items={feature.attributes.map(([key, value]) => [words(key), fact(value)])} />
      )}
      {feature.causes.length > 0 && (
        <ul className="cell-causes">
          {feature.causes.map((cause, i) => (
            <li key={i}>{cause}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

const shape = (type: string) =>
  type.includes("Point")
    ? "on this cell"
    : type.includes("Line")
      ? "through this cell"
      : "covers this cell";

function fact(value: string | number | boolean) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return words(value);
  return Number.isInteger(value)
    ? value.toLocaleString()
    : Number(value.toPrecision(4)).toLocaleString();
}

/** camelCase or kebab-case identifiers as words. */
function words(value: string) {
  const spaced = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

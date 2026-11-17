import { useState } from "react";
import type { JsonValue, MapFeature, Position } from "@atlas/map";
import type { AuthoringSession } from "./useRealScaleAuthoring";
import { parseAngle, parseLength, showLength, type LengthUnits } from "./realScaleFields";
import { CaveWallFacts } from "./RealScaleLandTools";
import { BuildingFacts } from "./RealScaleBuilding";
import { RealScaleConnections } from "./RealScaleConnections";

interface Props {
  session: AuthoringSession;
  selected: MapFeature[];
  units: LengthUnits;
}
/** Attributes that belong to the shape or the map; the panel edits them through its own fields. */
const shapeKeys = new Set([
  "widths",
  "rotation",
  "creatorLayer",
  "locked",
  "placeId",
  "nameStatus",
  // A cave wall's depth and what it read there have their own fields.
  "depth",
  "cutDepth",
]);

function points(feature: MapFeature): Position[] {
  const geometry = feature.geometry;
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates[0].slice(0, -1);
  return geometry.type === "Point" ? [geometry.coordinates] : [];
}
function box(feature: MapFeature) {
  const xs = points(feature).map((p) => p[0]),
    ys = points(feature).map((p) => p[1]);
  const [w, s, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return { centre: [(w + e) / 2, (s + n) / 2] as [number, number], width: e - w, height: n - s };
}
function length(feature: MapFeature) {
  const line = points(feature);
  return line
    .slice(1)
    .reduce((sum, p, i) => sum + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
}

/** Position, angle and size first, then the kind's own attributes. */
export function RealScaleProperties({ session, selected, units }: Props) {
  if (selected.length !== 1)
    return selected.length ? <p>{selected.length} shapes selected</p> : <p>Nothing selected</p>;
  const [feature] = selected;
  return (
    <section aria-label="Selection properties" className="real-scale-properties">
      <h3>{feature.name || feature.kind}</h3>
      <TextField
        label="Name"
        value={feature.name ?? ""}
        commit={(name) =>
          session.run({ command: "setAttributes", ids: [feature.id], name, attributes: {} })
        }
      />
      <Placement session={session} feature={feature} units={units} />
      {feature.geometry.type === "LineString" && (
        <LinePoints session={session} feature={feature} units={units} />
      )}
      <BuildingFacts feature={feature} />
      <RealScaleConnections session={session} feature={feature} />
      <KindAttributes session={session} feature={feature} />
      <CaveWallFacts session={session} feature={feature} />
      {feature.attributes.locked === true && <p>Locked against pointer edits</p>}
    </section>
  );
}
function Placement({
  session,
  feature,
  units,
}: {
  session: AuthoringSession;
  feature: MapFeature;
  units: LengthUnits;
}) {
  const { centre, width } = box(feature);
  const line = feature.geometry.type === "LineString";
  const angle = typeof feature.attributes.rotation === "number" ? feature.attributes.rotation : 0;
  const transform = (change: { translate?: [number, number]; rotate?: number; scale?: number }) =>
    session.run({
      command: "transform",
      ids: [feature.id],
      transform: { translate: [0, 0], rotate: 0, scale: 1, about: centre, ...change },
    });
  const size = line ? length(feature) : width;
  return (
    <fieldset>
      <legend>Placement</legend>
      <LengthField
        label="X"
        value={centre[0]}
        units={units}
        commit={(x) => transform({ translate: [x - centre[0], 0] })}
      />
      <LengthField
        label="Y"
        value={centre[1]}
        units={units}
        commit={(y) => transform({ translate: [0, y - centre[1]] })}
      />
      {!line && (
        <TextField
          label="Angle"
          value={`${angle}°`}
          commit={(text) => {
            const next = parseAngle(text, angle);
            if (next !== null && next !== angle) void transform({ rotate: next - angle });
          }}
        />
      )}
      <LengthField
        label={line ? "Length" : "Width"}
        value={size}
        units={units}
        commit={(next) => size > 0 && next > 0 && transform({ scale: next / size })}
      />
    </fieldset>
  );
}
function LinePoints({
  session,
  feature,
  units,
}: {
  session: AuthoringSession;
  feature: MapFeature;
  units: LengthUnits;
}) {
  const line = points(feature);
  const widths = Array.isArray(feature.attributes.widths)
    ? (feature.attributes.widths as number[])
    : null;
  const move = (index: number, axis: 0 | 1, value: number) => {
    const coordinates = line.map((p, i) =>
      i === index ? (axis === 0 ? [value, p[1]] : [p[0], value]) : p
    ) as Position[];
    return session.run({
      command: "reshape",
      id: feature.id,
      geometry: { type: "LineString", coordinates },
    });
  };
  const widen = (index: number, value: number) =>
    session.run({
      command: "setAttributes",
      ids: [feature.id],
      name: null,
      attributes: { widths: widths!.map((w, i) => (i === index ? value : w)) },
    });
  return (
    <fieldset>
      <legend>Points along the line</legend>
      {line.map((point, index) => (
        <div key={index} className="line-point" aria-label={`Point ${index + 1}`} role="group">
          <LengthField
            label={`Point ${index + 1} X`}
            value={point[0]}
            units={units}
            commit={(v) => move(index, 0, v)}
          />
          <LengthField
            label={`Point ${index + 1} Y`}
            value={point[1]}
            units={units}
            commit={(v) => move(index, 1, v)}
          />
          {widths && (
            <LengthField
              label={`Point ${index + 1} width`}
              value={widths[index]}
              units={units}
              commit={(v) => v > 0 && widen(index, v)}
            />
          )}
        </div>
      ))}
    </fieldset>
  );
}
function KindAttributes({ session, feature }: { session: AuthoringSession; feature: MapFeature }) {
  const entries = Object.entries(feature.attributes).filter(
    ([key, value]) => !shapeKeys.has(key) && value !== null && typeof value !== "object"
  );
  if (!entries.length) return null;
  const set = (key: string, text: string, previous: JsonValue) => {
    const value: JsonValue =
      typeof previous === "number" && Number.isFinite(Number(text)) ? Number(text) : text;
    return session.run({
      command: "setAttributes",
      ids: [feature.id],
      name: null,
      attributes: { [key]: value },
    });
  };
  return (
    <fieldset>
      <legend>Attributes</legend>
      {entries.map(([key, value]) => (
        <TextField
          key={key}
          label={key}
          value={String(value)}
          commit={(text) => set(key, text, value as JsonValue)}
        />
      ))}
    </fieldset>
  );
}
function LengthField(props: {
  label: string;
  value: number;
  units: LengthUnits;
  commit(metres: number): unknown;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <TextField
      label={props.label}
      value={showLength(props.value, props.units)}
      invalid={invalid}
      commit={(text) => {
        const metres = parseLength(text, props.value, props.units);
        setInvalid(metres === null);
        if (metres !== null && Math.abs(metres - props.value) > 1e-9) void props.commit(metres);
      }}
    />
  );
}
function TextField(props: {
  label: string;
  value: string;
  invalid?: boolean;
  commit(text: string): unknown;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && draft !== props.value) void props.commit(draft);
    setDraft(null);
  };
  return (
    <label>
      {props.label}
      <input
        value={draft ?? props.value}
        aria-invalid={props.invalid || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    </label>
  );
}

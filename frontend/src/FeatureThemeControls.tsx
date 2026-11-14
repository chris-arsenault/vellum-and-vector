import { useState, useEffect, useRef } from "react";
import { setTypeVisibility, typePresentation } from "./featureTypePresentation";
import type { FeatureType, FeatureTypeStyle } from "./types";
import type { GeometryType } from "@atlas/map";
import type { LayerStyle } from "./types";
import "./featureCatalogue.css";

export interface ThemeType extends FeatureType {
  count: number;
  geometries: GeometryType[];
  footprints: boolean;
}
interface Context {
  styles: LayerStyle[];
  setStyles(value: LayerStyle[]): void;
  layerName(id: string): string;
  edit: (target: string) => void;
  allTypes: ThemeType[];
}
export function FeatureThemeControls(context: Context) {
  const [empty, setEmpty] = useState(false);
  const [search, setSearch] = useState("");
  const types = context.allTypes.filter((type) => empty || type.count > 0);
  const matches = types.filter((t) =>
    t.path.join(" ").toLowerCase().includes(search.toLowerCase())
  );
  return (
    <details className="feature-themes" open>
      <summary>
        Features{" "}
        <small>
          {context.allTypes.reduce((sum, type) => sum + type.count, 0).toLocaleString()} in this map
        </small>
      </summary>
      <div className="feature-filters">
        <input
          type="search"
          aria-label="Search features"
          placeholder="Find a feature type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            aria-label="Show empty layers"
            checked={empty}
            onChange={(e) => setEmpty(e.target.checked)}
          />
          Empty types
        </label>
      </div>
      <TypeGroups types={matches} path={[]} context={context} />
      {!matches.length && <p className="hint">No matching feature types in this map.</p>}
    </details>
  );
}
function TypeGroups({
  types,
  path,
  context,
}: {
  types: ThemeType[];
  path: string[];
  context: Context;
}) {
  const names = [...new Set(types.map((t) => t.path[path.length]))];
  return (
    <>
      {names.map((name) => {
        const next = [...path, name],
          members = types.filter((t) => t.path[path.length] === name);
        const leaf = members.length === 1 && members[0].path.length === next.length;
        return leaf ? (
          <TypeRow key={members[0].id} type={members[0]} context={context} />
        ) : (
          <TypeGroup key={name} types={members} path={next} context={context} />
        );
      })}
    </>
  );
}
function TypeGroup({
  types,
  path,
  context,
}: {
  types: ThemeType[];
  path: string[];
  context: Context;
}) {
  const visible = types.filter(
    (t) =>
      typePresentation(
        t,
        context.styles.find((s) => s.layerId === t.layerId)!
      ).visible
  ).length;
  const count = types.reduce((sum, type) => sum + type.count, 0);
  const toggle = (enabled: boolean) => showTypes(context, types, enabled);
  return (
    <details className="feature-type-group" open={true}>
      <summary>
        <MixedCheck
          label={`Show ${path.at(-1)}`}
          checked={visible === types.length}
          mixed={visible > 0 && visible < types.length}
          change={toggle}
        />
        <span>{path.at(-1)}</span>
        <small>{count.toLocaleString()}</small>
      </summary>
      <div className="feature-type-children">
        <TypeGroups types={types} path={path} context={context} />
      </div>
    </details>
  );
}
function MixedCheck({
  label,
  checked,
  mixed,
  change,
}: {
  label: string;
  checked: boolean;
  mixed: boolean;
  change: (value: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={input}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => change(e.target.checked)}
    />
  );
}
function TypeRow({ type, context }: { type: ThemeType; context: Context }) {
  const style = context.styles.find((s) => s.layerId === type.layerId)!;
  const effective = typePresentation(type, style);
  const update = (changes: FeatureTypeStyle) =>
    changes.visible === undefined
      ? context.setStyles(
          context.styles.map((s) =>
            s.layerId === type.layerId
              ? { ...s, types: { ...s.types, [type.id]: { ...s.types?.[type.id], ...changes } } }
              : s
          )
        )
      : showTypes(context, [type], changes.visible);
  return (
    <details className="feature-type-row">
      <summary>
        <label className="check">
          <input
            type="checkbox"
            aria-label={`Show ${type.label}`}
            checked={effective.visible}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => update({ visible: e.target.checked })}
          />
          <span className="geometry-symbol" aria-hidden="true">
            {geometrySymbol(type.geometries)}
          </span>
          <span>{type.label}</span>
          <small>{type.count.toLocaleString()}</small>
        </label>
        <button
          className="quiet"
          aria-label={`Style ${context.layerName(type.layerId)}`}
          onClick={(e) => {
            e.preventDefault();
            context.edit(`vector:${type.layerId}`);
          }}
        >
          Style
        </button>
      </summary>
      <TypeAppearance
        type={type}
        context={context}
        effective={effective}
        presentation={style}
        update={update}
      />
    </details>
  );
}
function TypeAppearance({
  type,
  context,
  effective,
  presentation: style,
  update,
}: {
  type: ThemeType;
  context: Context;
  effective: ReturnType<typeof typePresentation>;
  presentation: LayerStyle;
  update: (changes: FeatureTypeStyle) => void;
}) {
  return (
    <div className="feature-type-appearance">
      {type.footprints && (
        <label className="check">
          <input
            type="checkbox"
            aria-label={`Footprints for ${type.label}`}
            checked={Boolean(effective.footprints)}
            onChange={(e) => update({ footprints: e.target.checked })}
          />
          Surrounding footprints
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          aria-label={`Labels for ${type.label}`}
          checked={Boolean(effective.labels)}
          onChange={(e) => update({ labels: e.target.checked })}
        />
        Labels
      </label>
      <label>
        Color
        <input
          type="color"
          aria-label={`Color for ${type.label}`}
          value={effective.color}
          onChange={(e) => update({ color: e.target.value })}
        />
      </label>
      <label>
        Opacity
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          aria-label={`Opacity for ${type.label}`}
          value={style.types?.[type.id]?.opacity ?? 1}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </label>
      <button className="quiet" onClick={() => context.edit(`vector:${type.layerId}`)}>
        Layer symbols and draw order
      </button>
    </div>
  );
}
/** Only the targeted types change; every other type keeps what it shows now. */
function showTypes(context: Context, targets: FeatureType[], visible: boolean) {
  const ids = new Set(targets.map((type) => type.id)),
    layers = new Set(targets.map((type) => type.layerId));
  context.setStyles(
    context.styles.map((style) =>
      layers.has(style.layerId)
        ? setTypeVisibility(
            style,
            context.allTypes.filter((type) => type.layerId === style.layerId),
            ids,
            visible
          )
        : style
    )
  );
}
function geometrySymbol(geometries: GeometryType[]) {
  const types = new Set(geometries);
  if (types.size > 1) return "◈";
  const kind = geometries[0] ?? "";
  if (kind.includes("Point")) return "●";
  if (kind.includes("Line")) return "╱";
  return kind ? "▱" : "◇";
}

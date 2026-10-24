import { useMemo, useState, useEffect, useRef } from "react";
import {
  availableFeatureTypes,
  describeFeature,
  featureGroupKey,
  typePresentation,
  type FeatureType,
  type FeatureTypeStyle,
} from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { AtlasFeature } from "./types";
import type { LayerStyle } from "./types";
import "./featureCatalogue.css";

interface Context {
  editor: EditorState;
  features: AtlasFeature[];
  edit: (target: string) => void;
  search: string;
}
const noFeatures: AtlasFeature[] = [];
export function FeatureThemes({ editor, edit }: Pick<Context, "editor" | "edit">) {
  const [empty, setEmpty] = useState(false);
  const [search, setSearch] = useState("");
  const features = editor.scene.data ?? noFeatures;
  const types = useMemo(
    () => availableFeatureTypes(editor.world, features, empty),
    [editor.world, features, empty]
  );
  const matches = types.filter((t) =>
    t.path.join(" ").toLowerCase().includes(search.toLowerCase())
  );
  const context = { editor, edit, features, search };
  return (
    <details className="feature-themes" open>
      <summary>
        Features <small>{features.length.toLocaleString()} in this map</small>
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
  types: FeatureType[];
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
  types: FeatureType[];
  path: string[];
  context: Context;
}) {
  const { editor } = context;
  const visible = types.filter(
    (t) =>
      typePresentation(
        t,
        editor.styles.find((s) => s.layerId === t.layerId)!
      ).visible
  ).length;
  const count = context.features.filter((f) =>
    types.some((t) => t.id === describeFeature(editor.world, f).id)
  ).length;
  const toggle = (enabled: boolean) =>
    editor.setStyles(
      editor.styles.map((style) => {
        if (!types.some((t) => t.layerId === style.layerId)) return style;
        const groups = { ...style.groups, [featureGroupKey(path)]: enabled };
        if (enabled)
          path.forEach((_, i) => {
            groups[featureGroupKey(path.slice(0, i + 1))] = true;
          });
        return { ...style, visible: enabled || style.visible, groups };
      })
    );
  return (
    <details className="feature-type-group" open={true}>
      <summary>
        <MixedCheck
          label={`Show ${path.at(-1)}`}
          checked={visible > 0}
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
function TypeRow({ type, context }: { type: FeatureType; context: Context }) {
  const { editor, features } = context;
  const style = editor.styles.find((s) => s.layerId === type.layerId)!;
  const effective = typePresentation(type, style);
  const members = features.filter((f) => describeFeature(editor.world, f).id === type.id);
  const update = (changes: FeatureTypeStyle) =>
    editor.setStyles(
      editor.styles.map((s) => {
        if (s.layerId !== type.layerId) return s;
        const groups = { ...s.groups };
        if (changes.visible)
          type.path.forEach((_, i) => {
            groups[featureGroupKey(type.path.slice(0, i + 1))] = true;
          });
        return {
          ...s,
          visible: changes.visible || s.visible,
          groups,
          types: { ...s.types, [type.id]: { ...s.types?.[type.id], ...changes } },
        };
      })
    );
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
            {geometrySymbol(members)}
          </span>
          <span>{type.label}</span>
          <small>{members.length.toLocaleString()}</small>
        </label>
        <button
          className="quiet"
          aria-label={`Style ${editor.world.layers[type.layerId].name}`}
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
        members={members}
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
  members,
  effective,
  presentation: style,
  update,
}: {
  type: FeatureType;
  context: Context;
  members: AtlasFeature[];
  effective: ReturnType<typeof typePresentation>;
  presentation: LayerStyle;
  update: (changes: FeatureTypeStyle) => void;
}) {
  return (
    <div className="feature-type-appearance">
      {members.some((f) => f.footprint) && (
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
function geometrySymbol(features: AtlasFeature[]) {
  const types = new Set(features.map((f) => f.geometry.type));
  if (types.size > 1) return "◈";
  const kind = features[0]?.geometry.type ?? "";
  if (kind.includes("Point")) return "●";
  if (kind.includes("Line")) return "╱";
  return kind ? "▱" : "◇";
}

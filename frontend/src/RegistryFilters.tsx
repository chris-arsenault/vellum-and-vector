import { useState } from "react";
import type { World } from "./types";
import type { RegistryColumn, RegistryQuery, RegistryRow, AttributeFilter } from "./registryData";

export function RegistryFilters({
  rows,
  query,
  change,
  world,
}: {
  rows: RegistryRow[];
  query: RegistryQuery;
  change: (q: RegistryQuery) => void;
  world: World;
}) {
  const types = [...new Map(rows.map((r) => [r.type.id, r.type])).values()];
  return (
    <div className="registry-filters">
      <input
        type="search"
        aria-label="Search registry"
        placeholder="Find a named feature…"
        value={query.search}
        onChange={(e) => change({ ...query, search: e.target.value })}
      />
      <label>
        Feature type
        <select
          aria-label="Registry feature type"
          value={query.type}
          onChange={(e) => change({ ...query, type: e.target.value })}
        >
          <option value="">All feature types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.path.join(" / ")}
            </option>
          ))}
        </select>
      </label>
      <CategoryFilters rows={rows} query={query} change={change} world={world} />
      <label className="check">
        <input
          type="checkbox"
          checked={query.named}
          onChange={(e) => change({ ...query, named: e.target.checked })}
        />
        Named features only
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={query.protectedOnly}
          onChange={(e) => change({ ...query, protectedOnly: e.target.checked })}
        />
        Protected features only
      </label>
    </div>
  );
}
function CategoryFilters({ rows, query, change, world }: Parameters<typeof RegistryFilters>[0]) {
  const categories = [
    { key: "status", label: "Status" },
    { key: "state", label: "Authorship" },
    { key: "profile", label: "Profile" },
    { key: "space", label: "Located space" },
  ] as const;
  return (
    <>
      {categories.map(({ key, label }) => (
        <label key={key}>
          {label}
          <select
            aria-label={`Registry ${label}`}
            value={query[key]}
            onChange={(e) => change({ ...query, [key]: e.target.value })}
          >
            <option value="">All</option>
            {[...new Set(rows.map((r) => String(r.values[key] ?? "")))]
              .filter(Boolean)
              .sort()
              .map((v) => (
                <option key={v} value={v}>
                  {key === "space" ? (world.areas[v]?.name ?? "World surface") : v}
                </option>
              ))}
          </select>
        </label>
      ))}
    </>
  );
}
export function AttributeFilters({
  columns,
  query,
  change,
}: {
  columns: RegistryColumn[];
  query: RegistryQuery;
  change: (q: RegistryQuery) => void;
}) {
  const [draft, setDraft] = useState<AttributeFilter>({
    key: "population",
    text: "",
    min: "",
    max: "",
  });
  const column = columns.find((c) => c.key === draft.key);
  return (
    <details>
      <summary>Attribute filters ({query.attributes.length})</summary>
      <div className="registry-attribute-filter">
        <label>
          Attribute
          <select
            aria-label="Filter attribute"
            value={draft.key}
            onChange={(e) => setDraft({ key: e.target.value, text: "", min: "", max: "" })}
          >
            <option value="">Choose attribute</option>
            {columns.map((c) => (
              <option value={c.key} key={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <FilterValueInputs draft={draft} change={setDraft} numeric={Boolean(column?.numeric)} />
        <button
          disabled={!column || !(draft.text || draft.min || draft.max)}
          onClick={() => {
            change({ ...query, attributes: [...query.attributes, draft] });
            setDraft({ ...draft, text: "", min: "", max: "" });
          }}
        >
          Add attribute filter
        </button>
      </div>
      {query.attributes.map((f, i) => (
        <p key={i}>
          {columns.find((c) => c.key === f.key)?.label ?? f.key}:{" "}
          {f.text || `${f.min || "any"} to ${f.max || "any"}`}
          <button
            className="quiet"
            aria-label={`Remove attribute filter ${i + 1}`}
            onClick={() =>
              change({ ...query, attributes: query.attributes.filter((_, n) => n !== i) })
            }
          >
            Remove
          </button>
        </p>
      ))}
    </details>
  );
}
function FilterValueInputs({
  draft,
  change,
  numeric,
}: {
  draft: AttributeFilter;
  change: (next: AttributeFilter) => void;
  numeric: boolean;
}) {
  if (numeric)
    return (
      <>
        <label>
          Minimum
          <input
            type="number"
            aria-label="Attribute minimum"
            value={draft.min}
            onChange={(e) => change({ ...draft, min: e.target.value })}
          />
        </label>
        <label>
          Maximum
          <input
            type="number"
            aria-label="Attribute maximum"
            value={draft.max}
            onChange={(e) => change({ ...draft, max: e.target.value })}
          />
        </label>
      </>
    );
  return (
    <label>
      Contains
      <input
        aria-label="Attribute contains"
        value={draft.text}
        onChange={(e) => change({ ...draft, text: e.target.value })}
      />
    </label>
  );
}

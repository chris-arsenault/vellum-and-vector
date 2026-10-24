import { useEffect, useMemo, useState } from "react";
import { presentAtlasFeature, rectangle, presentedFeatureStyle, type Bounds } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { AtlasFeature } from "./types";
import {
  registryRows,
  registryColumns,
  matchesRegistry,
  sortRegistry,
  registryCell,
  type RegistryRow,
  type RegistryQuery,
  type RegistryColumn,
} from "./registryData";
import { RegistryFilters, AttributeFilters } from "./RegistryFilters";
import { bounds } from "./presentation";
import { useJobs } from "./useAtlas";
import "./featureRegistry.css";

const initialQuery: RegistryQuery = {
  search: "",
  type: "",
  status: "",
  state: "",
  profile: "",
  space: "",
  named: true,
  protectedOnly: false,
  attributes: [],
};
export function FeatureRegistry({ editor }: { editor: EditorState }) {
  const model = useRegistryModel(editor);
  return (
    <section
      className={model.expanded ? "feature-registry expanded" : "feature-registry"}
      aria-label="World feature registry"
    >
      <RegistryHeader model={model} worldId={editor.world.id} />
      <RegistryFilters
        rows={model.rows}
        query={model.query}
        change={model.update}
        world={editor.world}
      />
      <AttributeFilters columns={model.available} query={model.query} change={model.update} />
      <ColumnPicker
        available={model.available}
        selected={model.columns}
        change={model.setColumns}
      />
      <RegistryResults model={model} editor={editor} />
    </section>
  );
}
function useRegistryModel(editor: EditorState) {
  const [scope, setScope] = useState("world"),
    [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState({ key: "name", descending: false });
  const [columns, setColumns] = useState(["name", "type", "map", "population"]);
  const [page, setPage] = useState(0),
    [expanded, setExpanded] = useState(false);
  const world = editor.world;
  const rows = useMemo(
    () =>
      registryRows(
        world,
        scope === "world" ? undefined : editor.area.id,
        scope === "viewport" && editor.viewportExtent
          ? rectangle(editor.viewportExtent as Bounds)
          : undefined
      ),
    [world, scope, editor.area.id, editor.viewportExtent]
  );
  const available = useMemo(() => registryColumns(rows, world), [rows, world]);
  const filtered = useMemo(
    () =>
      sortRegistry(
        rows.filter((r) => matchesRegistry(r, query)),
        sort.key,
        sort.descending
      ),
    [rows, query, sort]
  );
  const visible = available.filter((c) => columns.includes(c.key));
  const open = useRegistryNavigation(editor);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 100) - 1));
  const update = (next: RegistryQuery) => {
    setQuery(next);
    setPage(0);
  };
  return {
    scope,
    setScope,
    query,
    sort,
    setSort,
    columns,
    setColumns,
    page,
    setPage,
    expanded,
    setExpanded,
    rows,
    available,
    filtered,
    visible,
    open,
    currentPage,
    update,
  };
}
type RegistryModel = ReturnType<typeof useRegistryModel>;
function RegistryHeader({ model, worldId }: { model: RegistryModel; worldId: string }) {
  const { scope, setScope, setPage, expanded, setExpanded } = model;
  const jobs = useJobs(worldId);
  return (
    <>
      <header>
        <h3>Feature registry</h3>
        <button className="quiet" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Compact table" : "Expand table"}
        </button>
      </header>
      <p className="hint">
        Find existing geography across this world. Finer places open in their own maps.
      </p>
      {jobs.data?.[0]?.partial && (
        <p role="status">Initial generation is incomplete; delivered features are listed.</p>
      )}
      <label>
        Geographic scope
        <select
          aria-label="Registry scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setPage(0);
          }}
        >
          <option value="world">Whole world</option>
          <option value="map">Current mapped area</option>
          <option value="viewport">Current viewport</option>
        </select>
      </label>
    </>
  );
}
function RegistryResults({ model, editor }: { model: RegistryModel; editor: EditorState }) {
  const { filtered, rows, visible, sort, setSort, open, currentPage, setPage } = model;
  return (
    <>
      <p role="status">
        {filtered.length.toLocaleString()} matching features · {rows.length.toLocaleString()} in
        scope
      </p>
      <RegistryTable
        rows={filtered.slice(currentPage * 100, (currentPage + 1) * 100)}
        columns={visible}
        sort={sort}
        changeSort={setSort}
        open={open}
        editor={editor}
      />
      {!filtered.length && <p>No matching features. Change the scope or filters.</p>}
      <nav className="registry-pages" aria-label="Registry pages">
        <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
          Previous page
        </button>
        <span>
          Page {currentPage + 1} of {Math.max(1, Math.ceil(filtered.length / 100))}
        </span>
        <button
          disabled={(currentPage + 1) * 100 >= filtered.length}
          onClick={() => setPage(currentPage + 1)}
        >
          Next page
        </button>
      </nav>
    </>
  );
}
function ColumnPicker({
  available,
  selected,
  change,
}: {
  available: RegistryColumn[];
  selected: string[];
  change: (next: string[]) => void;
}) {
  return (
    <details>
      <summary>Columns</summary>
      <div className="registry-column-picker">
        {available.map((c) => (
          <label className="check" key={c.key}>
            <input
              type="checkbox"
              aria-label={`Column ${c.label}`}
              checked={selected.includes(c.key)}
              disabled={c.key === "name"}
              onChange={(e) =>
                change(
                  e.target.checked ? [...selected, c.key] : selected.filter((k) => k !== c.key)
                )
              }
            />
            {c.label}
          </label>
        ))}
      </div>
    </details>
  );
}
function RegistryTable({
  rows,
  columns,
  sort,
  changeSort,
  open,
  editor,
}: {
  rows: RegistryRow[];
  columns: RegistryColumn[];
  sort: { key: string; descending: boolean };
  changeSort: (next: { key: string; descending: boolean }) => void;
  open: (feature: AtlasFeature) => void;
  editor: EditorState;
}) {
  return (
    <div className="registry-scroll">
      <table className="registry-table">
        <caption className="sr-only">Named world features and attributes</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={
                  sort.key === c.key ? (sort.descending ? "descending" : "ascending") : "none"
                }
              >
                <button
                  onClick={() =>
                    changeSort({ key: c.key, descending: sort.key === c.key && !sort.descending })
                  }
                >
                  {c.label}
                </button>
              </th>
            ))}
            <th scope="col">Map</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.feature.id} aria-selected={editor.selected?.id === row.feature.id}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.key === "name" ? (
                    <button className="quiet" onClick={() => open(row.feature)}>
                      {row.feature.name}
                    </button>
                  ) : (
                    registryCell(row, c)
                  )}
                </td>
              ))}
              <td>
                <button
                  className="quiet"
                  aria-label={`Show ${row.feature.name} on map`}
                  onClick={() => open(row.feature)}
                >
                  Show on map
                </button>
                {isHidden(editor, row.feature) && <small>Hidden layer</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function isHidden(editor: EditorState, feature: AtlasFeature) {
  const style = editor.styles.find((s) => s.layerId === feature.layerId);
  return style ? !presentedFeatureStyle(editor.world, feature, style).visible : true;
}
function useRegistryNavigation(editor: EditorState) {
  const [pending, setPending] = useState<{ feature: AtlasFeature; areaId: string } | null>(null);
  useEffect(() => {
    if (!pending || !editor.mapEngine || editor.area.id !== pending.areaId) return;
    const engine = editor.mapEngine;
    const frame = requestAnimationFrame(() => {
      const f = pending.feature,
        extent = bounds(f.footprint ?? f.geometry);
      engine.map.getView().fit(extent, {
        padding: [60, 60, 60, 60],
        minResolution:
          f.geometry.type === "Point"
            ? Math.max(
                1,
                (bounds(editor.area.footprint)[2] - bounds(editor.area.footprint)[0]) / 1200
              )
            : 0,
      });
      setPending(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, editor.area, editor.mapEngine]);
  return (feature: AtlasFeature) => {
    const presented = presentAtlasFeature(editor.world, feature, editor.area.id);
    const areaId = presented ? editor.area.id : feature.areaId;
    if (areaId !== editor.area.id) editor.enter(areaId);
    editor.select(presented ?? feature);
    setPending({ feature: presented ?? feature, areaId });
  };
}

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { presentedFeatureStyle, type Bounds } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { AtlasFeature } from "./types";
import {
  coreColumns,
  registryCell,
  type RegistryRow,
  type RegistryQuery,
  type RegistryColumn,
  type RegistryPage,
} from "@atlas/domain";
import { RegistryFilters, AttributeFilters } from "./RegistryFilters";
import { bounds } from "./presentation";
import { useWorld } from "./useAtlas";
import { atlasWorkspace } from "./atlasWorkspace";
import { editArea } from "./useScene";
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
        facets={model.facets}
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
  const areaId = scope === "world" ? undefined : editor.area.id;
  const extent = scope === "viewport" ? (editor.viewportExtent as Bounds | undefined) : undefined;
  const result = useQuery({
    queryKey: ["registry", world.id, world.version, areaId, extent, query, sort, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await atlasWorkspace()).readRegistry({
        worldId: world.id,
        areaId,
        extent: extent ?? undefined,
        query,
        sort,
        page,
        limit: 100,
      }),
  });
  const open = useRegistryNavigation(editor);
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
    ...registryResults(result.data, columns),
    pending: result.isFetching,
    error: result.error,
    open,
    update,
  };
}
function registryResults(data: RegistryPage | undefined, columns: string[]) {
  const page = data ?? {
    rows: [],
    columns: coreColumns,
    total: 0,
    matching: 0,
    page: 0,
    facets: { types: [], categories: { status: [], state: [], profile: [], space: [] } },
  };
  const available = page.columns;
  return {
    rows: page.rows,
    facets: page.facets,
    total: page.total,
    matching: page.matching,
    currentPage: page.page,
    available,
    visible: available.filter((column) => columns.includes(column.key)),
  };
}
type RegistryModel = ReturnType<typeof useRegistryModel>;
function RegistryHeader({ model, worldId }: { model: RegistryModel; worldId: string }) {
  const { scope, setScope, setPage, expanded, setExpanded } = model;
  const world = useWorld(worldId);
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
      {world.data?.publication?.state === "incomplete" && (
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
  const { matching, total, rows, visible, sort, setSort, open, currentPage, setPage } = model;
  return (
    <>
      <p role="status">
        {matching.toLocaleString()} matching features · {total.toLocaleString()} in scope
        {model.pending && " · Reading registry…"}
      </p>
      <RegistryTable
        rows={rows}
        columns={visible}
        sort={sort}
        changeSort={setSort}
        open={open}
        editor={editor}
      />
      {model.error && <p role="alert">{model.error.message}</p>}
      {!model.pending && !model.error && !matching && (
        <p>No matching features. Change the scope or filters.</p>
      )}
      <nav className="registry-pages" aria-label="Registry pages">
        <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
          Previous page
        </button>
        <span>
          Page {currentPage + 1} of {Math.max(1, Math.ceil(matching / 100))}
        </span>
        <button
          disabled={(currentPage + 1) * 100 >= matching}
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
    const areaId = editArea(editor.world, editor.area.id, feature);
    if (areaId !== editor.area.id) editor.enter(areaId);
    editor.select(feature);
    setPending({ feature, areaId });
  };
}

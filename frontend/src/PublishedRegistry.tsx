import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  Bounds,
  MapDescriptor,
  MapReader,
  MapRegistryQuery,
  MapRegistryRow,
  MapRegistryPage,
} from "@atlas/map";
import { RegistryFilters, AttributeFilters } from "./RegistryFilters";
import { PublishedRegistryTable, RegistryColumnPicker } from "./PublishedRegistryTable";
import "./featureRegistry.css";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
  extent?: Bounds;
  selected: string | null;
  open: (row: MapRegistryRow) => void;
  hidden: (row: MapRegistryRow) => boolean;
}
const initialQuery: MapRegistryQuery = {
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
export function PublishedRegistry(props: Props) {
  const model = usePublishedRegistry(props);
  return (
    <section
      className={model.expanded ? "feature-registry expanded" : "feature-registry"}
      aria-label="World feature registry"
    >
      <RegistryHeader model={model} />
      <RegistryFilters
        facets={model.facets}
        query={model.query}
        change={model.update}
        spaceNames={Object.fromEntries(
          model.rows.map((row) => [
            String(row.values.space),
            String(row.values.spaceLabel ?? "World surface"),
          ])
        )}
      />
      <AttributeFilters columns={model.available} query={model.query} change={model.update} />
      <RegistryColumnPicker
        available={model.available}
        selected={model.columns}
        change={model.setColumns}
      />
      <p role="status">
        {model.matching.toLocaleString()} matching features · {model.total.toLocaleString()} in
        scope
        {model.pending && " · Reading registry…"}
      </p>
      <PublishedRegistryTable
        rows={model.rows}
        columns={model.visible}
        sort={model.sort}
        changeSort={model.setSort}
        selected={props.selected}
        open={props.open}
        hidden={props.hidden}
      />
      {model.error && <p role="alert">{model.error.message}</p>}
      {!model.pending && !model.error && !model.matching && (
        <p>No matching features. Change the scope or filters.</p>
      )}
      <RegistryPages model={model} />
    </section>
  );
}
function usePublishedRegistry({ map, reader, extent }: Props) {
  const [scope, setScope] = useState("world");
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState({ key: "name", descending: false });
  const [columns, setColumns] = useState(["name", "type", "map", "population"]);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const bounds = scope === "viewport" ? extent : undefined;
  const result = useQuery({
    queryKey: ["map-registry", map.reference, scope, bounds, query, sort, page],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      reader.registry(
        map.reference,
        {
          scope: scope === "world" ? "world" : "map",
          bounds,
          query,
          sort,
          page,
          limit: 100,
        },
        { signal }
      ),
  });
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
    update: (next: MapRegistryQuery) => {
      setQuery(next);
      setPage(0);
    },
  };
}
function registryResults(data: MapRegistryPage | undefined, columns: string[]) {
  const page = data ?? {
    rows: [],
    columns: [],
    total: 0,
    matching: 0,
    page: 0,
    facets: { types: [], categories: { status: [], state: [], profile: [], space: [] } },
  };
  return {
    rows: page.rows,
    available: page.columns,
    visible: page.columns.filter((column) => columns.includes(column.key)),
    facets: page.facets,
    total: page.total,
    matching: page.matching,
    currentPage: page.page,
  };
}
type RegistryModel = ReturnType<typeof usePublishedRegistry>;
function RegistryHeader({ model }: { model: RegistryModel }) {
  return (
    <>
      <header>
        <h3>Feature registry</h3>
        <button className="quiet" onClick={() => model.setExpanded(!model.expanded)}>
          {model.expanded ? "Compact table" : "Expand table"}
        </button>
      </header>
      <p className="hint">
        Find existing geography across this world. Finer places open in their own maps.
      </p>
      <label>
        Geographic scope
        <select
          aria-label="Registry scope"
          value={model.scope}
          onChange={(e) => {
            model.setScope(e.target.value);
            model.setPage(0);
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
function RegistryPages({ model }: { model: RegistryModel }) {
  return (
    <nav className="registry-pages" aria-label="Registry pages">
      <button disabled={!model.currentPage} onClick={() => model.setPage(model.currentPage - 1)}>
        Previous page
      </button>
      <span>
        Page {model.currentPage + 1} of {Math.max(1, Math.ceil(model.matching / 100))}
      </span>
      <button
        disabled={(model.currentPage + 1) * 100 >= model.matching}
        onClick={() => model.setPage(model.currentPage + 1)}
      >
        Next page
      </button>
    </nav>
  );
}

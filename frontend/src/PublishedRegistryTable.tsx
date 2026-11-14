import type { MapColumn, MapRegistryRow } from "@atlas/map";
import { registryCell } from "./registryPresentation";

export function RegistryColumnPicker({
  available,
  selected,
  change,
}: {
  available: MapColumn[];
  selected: string[];
  change: (next: string[]) => void;
}) {
  return (
    <details>
      <summary>Columns</summary>
      <div className="registry-column-picker">
        {available.map((column) => (
          <label className="check" key={column.key}>
            <input
              type="checkbox"
              aria-label={`Column ${column.label}`}
              checked={selected.includes(column.key)}
              disabled={column.key === "name"}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? [...selected, column.key]
                    : selected.filter((key) => key !== column.key)
                )
              }
            />
            {column.label}
          </label>
        ))}
      </div>
    </details>
  );
}
interface TableProps {
  rows: MapRegistryRow[];
  columns: MapColumn[];
  sort: { key: string; descending: boolean };
  changeSort: (sort: { key: string; descending: boolean }) => void;
  selected: string | null;
  open: (row: MapRegistryRow) => void;
  hidden: (row: MapRegistryRow) => boolean;
}
export function PublishedRegistryTable({
  rows,
  columns,
  sort,
  changeSort,
  selected,
  open,
  hidden,
}: TableProps) {
  return (
    <div className="registry-scroll">
      <table className="registry-table">
        <caption className="sr-only">Named world features and attributes</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort.key === column.key ? (sort.descending ? "descending" : "ascending") : "none"
                }
              >
                <button
                  onClick={() =>
                    changeSort({
                      key: column.key,
                      descending: sort.key === column.key && !sort.descending,
                    })
                  }
                >
                  {column.label}
                </button>
              </th>
            ))}
            <th scope="col">Map</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.reference.mapId}:${row.feature.id}`}
              aria-selected={selected === row.feature.id}
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.key === "name" ? (
                    <button className="quiet" onClick={() => open(row)}>
                      {row.feature.name}
                    </button>
                  ) : (
                    registryCell(row, column)
                  )}
                </td>
              ))}
              <td>
                <button
                  className="quiet"
                  aria-label={`Show ${row.feature.name} on map`}
                  onClick={() => open(row)}
                >
                  Show on map
                </button>
                {hidden(row) && <small>Hidden layer</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

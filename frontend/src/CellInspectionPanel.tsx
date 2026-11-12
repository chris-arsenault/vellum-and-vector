import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { atlasWorkspace } from "./atlasWorkspace";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import type { CellInspection, InspectedCell, CellValue } from "./cellInspection";
import { categoryPalette } from "./rasterPresentation";
import { ErrorMessage } from "./ErrorMessage";
import { Facts } from "./InspectionSurface";
import { CellExplanation } from "./CellExplanation";
import { CellPeople, CellRock } from "./CellLand";
import "./cellInspection.css";

export function CellInspectionPanel({ world, editor }: { world: World; editor: EditorState }) {
  const point = editor.cellPoint?.areaId === editor.area.id ? editor.cellPoint.position : null,
    cell = useQuery({
      queryKey: ["cell", world.id, editor.area.id, world.version, point],
      enabled: point !== null,
      gcTime: 0,
      queryFn: async () => (await atlasWorkspace()).readCell(world.id, editor.area.id, point!),
    });
  return (
    <section className="cell-inspection">
      <p className="eyebrow">WHAT IS HERE</p>
      <h2>Inspect cell</h2>
      <p>Click the map to see what is at that place and why it looks the way it does.</p>
      {point && (
        <p>
          Clicked {point.x.toFixed(2)}, {point.y.toFixed(2)} m
        </p>
      )}
      {point && cell.isPending && <p role="status">Reading cell…</p>}
      <ErrorMessage error={cell.error} />
      {cell.data && <CellResult world={world} data={cell.data} />}
    </section>
  );
}

function CellResult({ world, data }: { world: World; data: CellInspection }) {
  const [filter, setFilter] = useState("");
  if (!data.cells.length && !data.features.length)
    return <p>No stored numerical cell at this position on this map.</p>;
  // The finest stored cell speaks first: its class is the one the map draws here.
  const finest = [...data.cells].sort((a, b) => a.measure - b.measure),
    values = finest.flatMap((cell) => cell.values);
  return (
    <>
      <CellExplanation world={world} values={values} features={data.features} />
      <CellPeople world={world} values={values} area={finest[0]?.measure ?? 0} />
      <CellRock world={world} values={values} />
      <details className="cell-stored">
        <summary>Stored values ({values.length} channels)</summary>
        <label>
          Filter channels
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="water, treeCover, elevation…"
          />
        </label>
        {data.cells.map((cell) => (
          <CellData
            key={`${cell.gridId}:${cell.index}`}
            cell={cell}
            world={world}
            filter={filter}
          />
        ))}
      </details>
    </>
  );
}

function CellData({ cell, world, filter }: { cell: InspectedCell; world: World; filter: string }) {
  const values = cell.values.filter((value) =>
    value.channel.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <section className="cell-data">
      <h3>
        Cell {cell.index}
        {cell.row === null ? "" : ` · row ${cell.row}, column ${cell.column}`}
      </h3>
      <Facts
        items={[
          ["Center (m)", `${cell.center.x.toFixed(2)}, ${cell.center.y.toFixed(2)}`],
          ["Bounds (m)", cell.bounds.map((value) => value.toFixed(2)).join(", ")],
          ["Area (m²)", String(cell.measure)],
          ["Active", cell.active ? "Yes" : "No"],
        ]}
      />
      <table>
        <caption>{cell.values.length} stored channels</caption>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Value</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value) => (
            <tr key={value.channel}>
              <th
                scope="row"
                title={`${value.input ? "Captured input" : "Present field"} · ${value.quantity}\nField ${value.fieldId}\nResource ${value.resourceId}`}
              >
                <code>{value.channel}</code>
              </th>
              <td>{formatCellValue(world, value)}</td>
              <td>{value.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatCellValue(world: World, value: CellValue) {
  const category = categoryPalette(world, value.channel)?.find(
    (category) => category.code === value.value
  );
  return category ? `${value.value} · ${category.name}` : String(value.value);
}

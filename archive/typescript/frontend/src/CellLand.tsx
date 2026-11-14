import { humanLayers, humanRemains, MapScale } from "@atlas/domain";
import type { World } from "./types";
import type { CellValue } from "./cellInspection";
import { Facts } from "./InspectionSurface";
import {
  cellReader as reader,
  rockLayers as layers,
  identityLayers as identity,
  landUse,
  round,
  percent,
  metres,
  type RockLayer,
} from "./cellLandFacts";
function ColumnTable({ title, rows }: { title: string; rows: RockLayer[] }) {
  if (!rows.length) return null;
  return (
    <table className="cell-column">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th>Layer, top first</th>
          <th>Thickness</th>
          <th>Strength</th>
          <th>Fractured</th>
          <th>Formed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.name}</th>
            <td>{metres(row.thickness)}</td>
            <td>{round(row.strength)}</td>
            <td>{percent(row.damage)}</td>
            <td>{row.formed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
/** The rock under the clicked place: loose cover over rock, and the same under its valleys. */
export function CellRock({ world, values }: { world: World; values: CellValue[] }) {
  const read = reader(values),
    intact = [...layers(world, read, "loose"), ...layers(world, read, "land")],
    valley = [...layers(world, read, "cutLoose"), ...layers(world, read, "cut")],
    cut = read("GroundCutShare");
  if (!intact.length && !valley.length) return null;
  return (
    <section className="cell-rock">
      <h3>Rock column</h3>
      {cut > 0 && (
        <p className="hint">
          Valleys cut {percent(cut)} of this cell, {metres(read("GroundCutDepth"))} deep.
        </p>
      )}
      <ColumnTable title={cut > 0 ? "Under the uncut ground" : "Under this ground"} rows={intact} />
      {cut > 0 && <ColumnTable title="Under the valley floors" rows={valley} />}
    </section>
  );
}

/** Who lives on the clicked place, what they have made of it, and whose they are. */
export function CellPeople({
  world,
  values,
  area,
}: {
  world: World;
  values: CellValue[];
  /** The cell's ground in square metres. */
  area: number;
}) {
  const read = reader(values),
    density = read(humanLayers.population),
    held = identity(world, read);
  if (!values.some((value) => value.channel === humanLayers.population)) return null;
  if (density <= 0 && read(humanRemains.builtUp) <= 0)
    return (
      <section className="cell-people">
        <h3>People here</h3>
        <p>Nobody lives on this cell and nothing built remains on it.</p>
      </section>
    );
  return (
    <section className="cell-people">
      <h3>People here</h3>
      <Facts items={landUse(read, MapScale.areaUnits(area, "m2", "km2"))} />
      {held.length > 0 && (
        <table className="cell-column">
          <caption>Who they are, newest layer first</caption>
          <thead>
            <tr>
              <th>Traditions</th>
              <th>Share of people</th>
              <th>Age</th>
              <th>Holds against change</th>
            </tr>
          </thead>
          <tbody>
            {held.map((layer) => (
              <tr key={layer.slot}>
                <th scope="row">{layer.traditions}</th>
                <td>{density > 0 ? percent(Math.min(1, layer.people / density)) : "—"}</td>
                <td>{round(layer.age)} years</td>
                <td>{percent(layer.hardness)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

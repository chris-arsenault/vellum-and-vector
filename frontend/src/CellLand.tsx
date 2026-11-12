import {
  columnFields,
  humanLayers,
  humanRemains,
  identityColumn,
  identitySlots,
  identityTraditions,
  MapScale,
  type Column,
} from "@atlas/domain";
import type { World } from "./types";
import type { CellValue } from "./cellInspection";
import { fieldClasses } from "./fieldNames";
import { Facts } from "./InspectionSurface";

type Read = (channel: string) => number;
const reader =
  (values: CellValue[]): Read =>
  (channel) =>
    values.find((value) => value.channel === channel)?.value ?? 0;
const round = (value: number) => Number(value.toPrecision(3)).toLocaleString();
const percent = (share: number) => `${round(share * 100)}%`;
const metres = (native: number) => {
  const value = MapScale.metres(native, "native");
  return value >= 1000 ? `${round(value / 1000)} km` : `${round(value)} m`;
};
const className = (world: World, channel: string, code: number) =>
  fieldClasses(world, channel)?.find((item) => item.code === code)?.name ?? `Kind ${code}`;

interface RockLayer {
  key: string;
  name: string;
  thickness: number;
  strength: number;
  damage: number;
  formed: string;
}
/** The layers one column of a cell holds, top first, as the ground stores them. */
function layers(world: World, read: Read, column: Column): RockLayer[] {
  const fields = columnFields[column],
    found: RockLayer[] = [];
  for (let slot = 0; slot < fields.depth.length; slot++) {
    const thickness = read(fields.depth[slot]);
    if (thickness <= 0) continue;
    const second = read(fields.secondaryShare[slot]),
      kind = className(world, fields.kind[slot], read(fields.kind[slot])),
      from = read(fields.formedMin[slot]),
      to = read(fields.formedMax[slot]);
    found.push({
      key: `${column}:${slot}`,
      name:
        second > 0
          ? `${kind} with ${percent(second)} ${className(world, fields.secondaryKind[slot], read(fields.secondaryKind[slot])).toLowerCase()}`
          : kind,
      thickness,
      strength: read(fields.strength[slot]),
      damage: read(fields.damage[slot]),
      formed: from === to ? `epoch ${from}` : `epochs ${from}–${to}`,
    });
  }
  return found;
}
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

interface IdentityLayer {
  slot: number;
  people: number;
  traditions: string;
  age: number;
  hardness: number;
}
const traditionWords = ["tongue", "faith", "custom", "realm", "craft"];
/** The identity layers people on a cell hold, newest first. */
function identity(world: World, read: Read): IdentityLayer[] {
  const found: IdentityLayer[] = [];
  for (let slot = 0; slot < identitySlots; slot++) {
    const people = read(identityColumn.people[slot]);
    if (people <= 0) continue;
    const named = identityTraditions.flatMap((tradition, index) => {
      const channel = identityColumn.traditions[tradition][slot],
        code = read(channel);
      return code > 0 ? [`${traditionWords[index]}: ${className(world, channel, code)}`] : [];
    });
    found.push({
      slot,
      people,
      traditions: named.join(" · ") || "no named tradition",
      age: read(identityColumn.age[slot]),
      hardness: read(identityColumn.hardness[slot]),
    });
  }
  return found;
}
function landUse(read: Read, areaKm2: number): [string, string][] {
  const density = read(humanLayers.population),
    ruined = read(humanRemains.builtUp);
  const facts: [string, string][] = [
    ["People", `${round(density)} per km² · about ${round(density * areaKm2)} on this cell`],
    ["Farmland", percent(read(humanLayers.farmland))],
    ["Pasture", percent(read(humanLayers.pasture))],
    ["Built-up ground", percent(read(humanLayers.builtUp))],
    ["Works and wealth", `${round(read(humanLayers.standing))} person-years per km²`],
  ];
  if (ruined > 0)
    facts.push([
      "Ruins",
      `${percent(ruined)} of the ground, ${percent(read(humanRemains.cover))} of them buried or drowned`,
    ]);
  return facts;
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

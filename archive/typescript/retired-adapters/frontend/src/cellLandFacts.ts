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

export type CellRead = (channel: string) => number;
export const cellReader =
  (values: CellValue[]): CellRead =>
  (channel) =>
    values.find((value) => value.channel === channel)?.value ?? 0;
export const round = (value: number) => Number(value.toPrecision(3)).toLocaleString();
export const percent = (share: number) => `${round(share * 100)}%`;
export const metres = (native: number) => {
  const value = MapScale.metres(native, "native");
  return value >= 1000 ? `${round(value / 1000)} km` : `${round(value)} m`;
};
const className = (world: World, channel: string, code: number) =>
  fieldClasses(world, channel)?.find((item) => item.code === code)?.name ?? `Kind ${code}`;

export interface RockLayer {
  key: string;
  name: string;
  thickness: number;
  strength: number;
  damage: number;
  formed: string;
}
/** The layers one column of a cell holds, top first, as the ground stores them. */
export function rockLayers(world: World, read: CellRead, column: Column): RockLayer[] {
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
export interface IdentityLayer {
  slot: number;
  people: number;
  traditions: string;
  age: number;
  hardness: number;
}
const traditionWords = ["tongue", "faith", "custom", "realm", "craft"];
/** The identity layers people on a cell hold, newest first. */
export function identityLayers(world: World, read: CellRead): IdentityLayer[] {
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
export function landUse(read: CellRead, areaKm2: number): [string, string][] {
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

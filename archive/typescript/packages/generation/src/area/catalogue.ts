import { unwritten } from "../poi/poiContract";
import type { AreaEntry, AreaForm } from "./areaContract";
import type { AreaKindId } from "./areaKinds";
import { river } from "./river";

/** A kind that has not moved onto this contract yet: every field is open work. */
const open = (id: AreaKindId, form: AreaForm, name: string): AreaEntry => ({
  id,
  form,
  name,
  recognition: { distinct: unwritten, covers: unwritten },
  existence: { statement: unwritten, way: unwritten, areas: unwritten },
  publication: { statement: unwritten, moment: unwritten, publish: unwritten },
  lineage: { statement: unwritten, identity: unwritten, continues: unwritten, adopt: unwritten },
  hosting: { statement: unwritten, linkAt: unwritten, cellFor: unwritten },
  fields: {
    statement: unwritten,
    terrain: unwritten,
    water: unwritten,
    climate: unwritten,
    cover: unwritten,
    magic: unwritten,
  },
  movement: {
    statement: unwritten,
    roads: unwritten,
    boats: unwritten,
    drainage: unwritten,
    magic: unwritten,
    links: unwritten,
    crosses: unwritten,
  },
  others: {
    statement: unwritten,
    needs: unwritten,
    excludes: unwritten,
    contains: unwritten,
    pairsWith: unwritten,
  },
  people: { statement: unwritten, offers: unwritten, threatens: unwritten },
  time: { statement: unwritten, fate: unwritten },
  visibility: {
    statement: unwritten,
    magnitude: unwritten,
    localConditions: unwritten,
    isolation: unwritten,
    cultural: unwritten,
    importance: unwritten,
  },
  naming: {
    statement: unwritten,
    namedBy: unwritten,
    takesNameFrom: unwritten,
    lendsNameTo: unwritten,
  },
});

/** One entry per kind; a missing or unknown kind does not compile. */
export const areaCatalogue: Readonly<Record<AreaKindId, AreaEntry>> = {
  river,
  fault: open("fault", "course", "Fault"),
  ocean: open("ocean", "region", "Ocean"),
  range: open("range", "region", "Range"),
  road: open("road", "network", "Road"),
  lane: open("lane", "network", "Sea lane"),
  polity: open("polity", "region", "Polity"),
  politicalRegion: open("politicalRegion", "region", "Political region"),
};

/** Every top-level field of an entry still unwritten: the area catalogue's open work. */
export function openAreaFields(entry: AreaEntry): string[] {
  return Object.entries(entry).flatMap(([role, fields]) =>
    typeof fields === "object" && fields !== null
      ? Object.entries(fields)
          .filter(([, value]) => value === unwritten)
          .map(([field]) => `${role}.${field}`)
      : []
  );
}

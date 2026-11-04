import { expect, it } from "vitest";
import { poiCatalogue, poiPages, unwrittenFields } from "./catalogue";
import { unwritten } from "./poiContract";
import { poiGroupIds, poiKindIds } from "./poiKinds";

/**
 * The agreed contract, pinned. Changing this list means changing the contract, which happens
 * only when the owner asks.
 */
const contract = {
  recognition: ["distinct", "isA"],
  existence: ["statement", "way", "requires", "suitability", "places"],
  fields: ["statement", "terrain", "water", "climate", "cover", "magic"],
  acrossMaps: ["statement", "carry", "realize", "counterpart", "unrealized", "settle"],
  movement: ["statement", "roads", "boats", "drainage", "magic", "crosses"],
  others: ["statement", "needs", "excludes", "contains", "pairsWith"],
  people: ["statement", "offers", "threatens"],
  time: ["statement", "fate"],
  visibility: ["statement", "magnitude", "localConditions", "isolation", "cultural", "visibleAt"],
  naming: ["statement", "namedBy", "takesNameFrom", "lendsNameTo"],
};

it("has one page per group and one entry per kind, on its own group", () => {
  expect(Object.keys(poiPages)).toEqual([...poiGroupIds]);
  for (const group of poiGroupIds) {
    expect(poiPages[group].id).toBe(group);
    for (const kind of poiKindIds[group]) {
      expect(poiCatalogue[kind].id).toBe(kind);
      expect(poiCatalogue[kind].group).toBe(group);
    }
  }
  expect(Object.keys(poiCatalogue).length).toBe(Object.values(poiKindIds).flat().length);
});

it("holds every entry to exactly the agreed roles and fields", () => {
  for (const entry of Object.values(poiCatalogue)) {
    const { id, group, name, ...roles } = entry;
    expect([id, group, name].every(Boolean)).toBe(true);
    expect(Object.keys(roles)).toEqual(Object.keys(contract));
    for (const [role, fields] of Object.entries(contract))
      expect(Object.keys(roles[role as keyof typeof roles]), `${id}.${role}`).toEqual(fields);
  }
});

it("lists an entry's unwritten fields as its open work", () => {
  const open = {
    ...poiCatalogue.summit,
    naming: { ...poiCatalogue.summit.naming, namedBy: unwritten },
  };
  expect(unwrittenFields(poiCatalogue.summit)).toEqual([]);
  expect(unwrittenFields(open)).toEqual(["naming.namedBy"]);
});

it("leaves no field of any entry unwritten", () => {
  const open = Object.values(poiCatalogue).flatMap((entry) =>
    unwrittenFields(entry).map((field) => `${entry.id}.${field}`)
  );
  expect(open).toEqual([]);
  for (const page of Object.values(poiPages)) {
    expect(page.belongs).not.toBe(unwritten);
    expect(page.excludes).not.toBe(unwritten);
  }
});

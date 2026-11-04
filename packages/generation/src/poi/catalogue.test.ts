import { canonryMagicPresets } from "@atlas/domain";
import { expect, it } from "vitest";
import { poiCatalogue, poiPages, unwrittenFields } from "./catalogue";
import { magicRuleKinds } from "./magicRuleKinds";
import { unwritten } from "./poiContract";
import { poiGroupIds, poiKindIds } from "./poiKinds";

/** The contract's shape: every entry answers exactly these. */
const contract = {
  recognition: ["distinct", "isA", "landform"],
  existence: ["statement", "way", "requires", "suitability", "places", "origins"],
  publication: ["statement", "moment", "record"],
  fields: ["statement", "terrain", "water", "climate", "cover", "magic"],
  acrossMaps: ["statement", "carry", "realize", "counterpart", "unrealized", "settle", "schedule"],
  movement: ["statement", "roads", "boats", "drainage", "magic", "links", "crosses"],
  others: ["statement", "needs", "excludes", "contains", "pairsWith"],
  people: ["statement", "offers", "threatens"],
  time: ["statement", "fate"],
  visibility: ["statement", "magnitude", "localConditions", "isolation", "cultural", "importance"],
  naming: ["statement", "namedBy", "takesNameFrom", "lendsNameTo", "term"],
};
/** The slots kinds answer as their turn comes; everything else is already answered. */
const openSlots = new Set([
  "variety",
  "appearance",
  "account",
  "recognition.landform",
  "existence.origins",
  "naming.term",
]);

it("gives every place rule of every magic system a kind in the catalogue", () => {
  const presets = canonryMagicPresets();
  expect(presets.map((system) => system.id).sort()).toEqual(Object.keys(magicRuleKinds).sort());
  for (const system of presets)
    for (const rule of system.features)
      expect(poiCatalogue[magicRuleKinds[system.id][rule.id]]?.id, `${system.id}:${rule.id}`).toBe(
        magicRuleKinds[system.id][rule.id]
      );
});

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
    const { id, group, name, variety, appearance, account, ...roles } = entry;
    expect([id, group, name, variety, appearance, account].every(Boolean)).toBe(true);
    expect(Object.keys(roles).sort()).toEqual(Object.keys(contract).sort());
    for (const [role, fields] of Object.entries(contract))
      expect(Object.keys(roles[role as keyof typeof roles]).sort(), `${id}.${role}`).toEqual(
        [...fields].sort()
      );
  }
});

it("lists an entry's unwritten fields as its open work", () => {
  const open = {
    ...poiCatalogue.peak,
    naming: { ...poiCatalogue.peak.naming, namedBy: unwritten },
  };
  expect(unwrittenFields(poiCatalogue.peak)).toEqual(["appearance", "account"]);
  expect(unwrittenFields(open)).toEqual(["appearance", "account", "naming.namedBy"]);
});

it("leaves no field of any entry unwritten but the slots still open", () => {
  const open = Object.values(poiCatalogue).flatMap((entry) =>
    unwrittenFields(entry)
      .filter((field) => !openSlots.has(field))
      .map((field) => `${entry.id}.${field}`)
  );
  expect(open).toEqual([]);
  for (const page of Object.values(poiPages)) {
    expect(page.belongs).not.toBe(unwritten);
    expect(page.excludes).not.toBe(unwritten);
  }
});

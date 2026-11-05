import { expect, it } from "vitest";
import { poiCatalogue } from "../poi/catalogue";
import { areaCatalogue, openAreaFields } from "./catalogue";
import { areaKindIds } from "./areaKinds";

const roles = {
  recognition: ["distinct", "covers"],
  existence: ["statement", "way", "areas"],
  publication: ["statement", "moment", "publish"],
  lineage: ["statement", "identity", "continues", "adopt"],
  hosting: ["statement", "linkAt", "cellFor"],
  fields: ["statement", "terrain", "water", "climate", "cover", "magic"],
  movement: ["statement", "roads", "boats", "drainage", "magic", "links", "crosses"],
  others: ["statement", "needs", "excludes", "contains", "pairsWith"],
  people: ["statement", "offers", "threatens"],
  time: ["statement", "fate"],
  visibility: ["statement", "magnitude", "localConditions", "isolation", "cultural", "importance"],
  naming: ["statement", "namedBy", "takesNameFrom", "lendsNameTo"],
};

it("has one entry per kind, holding every role and field", () => {
  expect(Object.keys(areaCatalogue)).toEqual([...areaKindIds]);
  for (const entry of Object.values(areaCatalogue))
    for (const [role, fields] of Object.entries(roles))
      expect(
        Object.keys(entry[role as keyof typeof entry] as object),
        `${entry.id}.${role}`
      ).toEqual(fields);
});

it("answers every field for a river, and lists what other kinds leave open", () => {
  expect(openAreaFields(areaCatalogue.river)).toEqual([]);
  expect(openAreaFields(areaCatalogue.ocean)).toContain("lineage.continues");
});

it("gives every place standing on a river an entry that says so", () => {
  const stands = Object.values(poiCatalogue)
    .filter((entry) => entry.acrossMaps.standsOn === "river")
    .map((entry) => entry.id)
    .sort();
  const contained = areaCatalogue.river.others.contains as readonly { kind: string }[];
  expect(contained.map(({ kind }) => kind).sort()).toEqual(stands);
});

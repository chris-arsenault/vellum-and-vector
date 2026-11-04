import { expect, it } from "vitest";
import { poiCatalogue, poiGroups } from "./catalogue";
import { poiGroupIds, poiKindIds } from "./poiKinds";

it("has one page per group and one entry per kind, on its own group's page", () => {
  expect(poiGroups.map((group) => group.id)).toEqual([...poiGroupIds]);
  for (const group of poiGroupIds)
    expect(poiCatalogue.filter((entry) => entry.group === group).map((entry) => entry.id)).toEqual([
      ...poiKindIds[group],
    ]);
  const ids = poiCatalogue.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});

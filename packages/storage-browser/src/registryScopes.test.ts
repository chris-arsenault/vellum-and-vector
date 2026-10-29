import type { Database } from "@sqlite.org/sqlite-wasm";
import { expect, it } from "vitest";
import { rectangle, type CatalogRecord, type RegistryRequest } from "@atlas/domain";
import { fixture, record, scope, write } from "./catalogFixture";

const request = (areaId?: string): RegistryRequest => ({
  worldId: scope.worldId,
  ...(areaId ? { areaId } : {}),
  page: 0,
  limit: 10,
  sort: { key: "name", descending: false },
  query: {
    search: "",
    type: "",
    status: "",
    state: "",
    profile: "",
    space: "",
    named: false,
    protectedOnly: false,
    attributes: [],
  },
});
it("builds each registry scope once and refreshes only marked rows in every scope", async () => {
  let db!: Database;
  const catalog = await fixture((opened) => {
    db = opened;
  });
  const root = (await catalog.readRecords(scope, "area", [scope.areaId]))[0];
  if (root.data.kind !== "area") throw new Error("Missing root.");
  const child: CatalogRecord = {
    scope: { ...scope, areaId: "child" },
    reference: { kind: "area", id: "child", revision: 0 },
    data: {
      kind: "area",
      value: {
        ...root.data.value,
        id: "child",
        parentId: scope.areaId,
        profile: "region",
        footprint: rectangle([0, 0, 500, 500]),
      },
    },
  };
  await write(catalog, [child, record("a"), record("b")]);
  const rows = (key: string) =>
    db.selectValues("SELECT row_id FROM registry_rows WHERE scope=? ORDER BY row_id", [key]);
  expect((await catalog.readRegistry(request())).total).toBe(2);
  const owned = rows("");
  expect((await catalog.readRegistry(request("child"))).total).toBe(2);
  const local = rows("child");
  expect((await catalog.readRegistry(request())).total).toBe(2);
  expect(rows("")).toEqual(owned);
  const facets = db.selectValue("SELECT summary FROM registry_scopes WHERE scope=''");
  expect(facets).toEqual(expect.any(String));
  const renamed = (await catalog.readRecords(scope, "feature", ["a"]))[0];
  if (renamed.data.kind !== "feature") throw new Error("Missing a.");
  renamed.data.value.name = "Renamed";
  await write(catalog, [renamed]);
  const page = await catalog.readRegistry(request("child"));
  expect(page.rows.map((row) => row.feature.name)).toEqual(["b", "Renamed"]);
  expect(rows("child").filter((id) => local.includes(id))).toHaveLength(1);
  expect((await catalog.readRegistry(request())).rows.map((r) => r.feature.name)).toEqual([
    "b",
    "Renamed",
  ]);
});

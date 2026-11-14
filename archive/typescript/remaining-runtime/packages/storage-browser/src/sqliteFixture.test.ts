import { expect, it } from "vitest";
import {
  exportSqliteFixture,
  sqliteFixture,
  sqliteFixtureFrom,
  sqliteFixtureMemory,
} from "./sqliteFixture";

it("restores an exported database with its rows and keeps it writable", async () => {
  const db = await sqliteFixture();
  db.exec("CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec({ sql: "INSERT INTO places (name) VALUES (?), (?)", bind: ["Ford", "Mill"] });
  const restored = await sqliteFixtureFrom(await exportSqliteFixture(db));
  db.close();
  expect(restored.selectValues("SELECT name FROM places ORDER BY id")).toEqual(["Ford", "Mill"]);
  restored.exec({ sql: "INSERT INTO places (name) VALUES (?)", bind: ["Weir"] });
  expect(restored.selectValue("SELECT count(*) FROM places")).toBe(3);
  restored.close();
});

it("attributes live allocations to the database's own instance and rejects closed readers", async () => {
  const populated = await sqliteFixture(),
    empty = await sqliteFixture();
  try {
    const before = sqliteFixtureMemory(populated);
    populated.exec(
      "CREATE TABLE payloads(data BLOB); INSERT INTO payloads VALUES(zeroblob(1048576))"
    );
    const occupied = sqliteFixtureMemory(populated),
      quiet = sqliteFixtureMemory(empty);
    expect(occupied.allocatedBytes).toBeGreaterThan(before.allocatedBytes + 1048576);
    expect(occupied.allocatedBytes).toBeGreaterThan(quiet.allocatedBytes + 1048576);
    expect(occupied.peakAllocatedBytes).toBeGreaterThanOrEqual(occupied.allocatedBytes);
    expect(occupied.wasmBytes).toBeGreaterThanOrEqual(occupied.allocatedBytes);
    expect(populated.selectValue("SELECT length(data) FROM payloads")).toBe(1048576);
  } finally {
    populated.close();
    empty.close();
  }
  expect(() => sqliteFixtureMemory(populated)).toThrow("open database");
});

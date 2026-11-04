import { expect, it } from "vitest";
import { exportSqliteFixture, sqliteFixture, sqliteFixtureFrom } from "./sqliteFixture";

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

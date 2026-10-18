import { expect, it } from "vitest";
import { testDatabase } from "../testDatabase";
import { randomUUID } from "node:crypto";
import { Database } from "./database";
import { flattenValue, restoreValue, readValues, writeValues } from "./typedValues";

it("retains typed empty containers, nulls, numeric/text types and hostile attribute names", () => {
  const value = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":4,"empty":[],"record":{},"null":null,"list":[{},[],0,"0",false]}'
  );
  const rows = flattenValue(value).sort(
    (a, b) => a.path.length - b.path.length || a.ordinal - b.ordinal
  );
  expect(restoreValue(rows)).toEqual(value);
  expect(Object.hasOwn(restoreValue(rows) as object, "__proto__")).toBe(true);
  expect(() => flattenValue({ value: Number.NaN })).toThrow();
  expect(() => restoreValue(rows.filter((row) => row.path.length !== 0))).toThrow();
});

it("isolates typed values by owner scope and rolls back failed writes", async () => {
  const db = await testDatabase();
  try {
    const alice = randomUUID(),
      bob = randomUUID(),
      database = new Database(db.client);
    await db.client.query(
      "INSERT INTO atlas_scopes VALUES($1,'alice','world'),($2,'bob','world')",
      [alice, bob]
    );
    const input = { settings: { decay: 0.3, options: ["cold", null, {}, []] }, enabled: false };
    const id = await database.transaction((sql) =>
      writeValues(sql, alice, input, "parameters", "example", 1)
    );
    expect((await readValues(db.client, alice, [id])).get(id)).toEqual(input);
    await expect(readValues(db.client, bob, [id])).rejects.toThrow("not found");
    await expect(
      database.transaction(async (sql) => {
        await writeValues(sql, alice, { aborted: true }, "continuation", "example", 1);
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");
    expect(
      (
        await db.client.query(
          "SELECT count(*)::int AS count FROM atlas_value_sets WHERE scope_id=$1",
          [alice]
        )
      ).rows[0].count
    ).toBe(1);
  } finally {
    await db.close();
  }
});

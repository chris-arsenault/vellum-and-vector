import sqliteInit from "@sqlite.org/sqlite-wasm";

export async function sqliteFixture() {
  const sqlite = await sqliteInit();
  return new sqlite.oo1.DB(":memory:");
}

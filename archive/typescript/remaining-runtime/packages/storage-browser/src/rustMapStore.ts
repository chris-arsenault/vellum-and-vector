import { BrowserMapStore } from "@atlas/engine";
import type { Database, BindableValue } from "./catalogDatabase";
import type { GeometryKernel } from "./geometryKernel";
import type { Geometry } from "geojson";
import { rustSpatial } from "./rustSpatial";

const stores = new WeakMap<Database, BrowserMapStore>();

/** Platform bindings only: Rust owns map schemas, SQL and publication/read rules. */
export function rustMapStore(db: Database, kernel?: GeometryKernel): BrowserMapStore {
  const held = stores.get(db);
  if (held) return held;
  if (!kernel) throw new Error("Open the map geometry binding before using its store.");
  const store = new BrowserMapStore(sqlDriver(db), geometryDriver(kernel));
  stores.set(db, store);
  return store;
}
export function closeMapStore(db: Database) {
  stores.get(db)?.free();
  stores.delete(db);
}
export function sqlDriver(db: Database) {
  return {
    batch: (sql: string) => {
      db.exec(sql);
    },
    execute(sql: string, values: BindableValue[]) {
      db.exec({ sql, bind: values });
      return db.changes();
    },
    query: (sql: string, values: BindableValue[]) => db.selectObjects(sql, values),
  };
}
function geometryDriver(kernel: GeometryKernel) {
  return {
    encode(shape: string, precision: number) {
      const encoded = kernel.encode(JSON.parse(shape) as Geometry, precision);
      return { bytes: encoded.bytes, bounds: JSON.stringify(encoded.bounds) };
    },
    decode: (bytes: Uint8Array) => JSON.stringify(kernel.decode(bytes)),
    spatial: (precision: number) => rustSpatial(kernel, precision),
  };
}

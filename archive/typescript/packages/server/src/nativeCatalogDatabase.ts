import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type {
  CatalogDatabase,
  CatalogStatement,
  CatalogValue,
  CatalogBinding,
} from "@atlas/storage-browser";

/** The same catalog SQL and publication rules use native SQLite on the backend volume. */
export class NativeCatalogDatabase implements CatalogDatabase {
  private db: DatabaseSync;
  private sequence = 0;
  constructor(path: string, readOnly = false) {
    this.db = new DatabaseSync(path, { readOnly });
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA cache_size=-4096; PRAGMA temp_store=FILE;");
  }
  exec(
    input:
      string | { sql: string; bind?: readonly CatalogBinding[] | Record<string, CatalogBinding> }
  ) {
    if (typeof input === "string") this.db.exec(input);
    else {
      const statement = this.db.prepare(input.sql);
      if (!input.bind || Array.isArray(input.bind)) statement.run(...bindings(input.bind));
      else
        statement.run(
          Object.fromEntries(
            Object.entries(input.bind).map(([key, value]) => [key, binding(value)])
          )
        );
    }
  }
  selectObject(sql: string, bind?: readonly CatalogBinding[]) {
    return this.db.prepare(sql).get(...bindings(bind));
  }
  selectObjects(sql: string, bind?: readonly CatalogBinding[]) {
    return this.db.prepare(sql).all(...bindings(bind));
  }
  selectValue(sql: string, bind?: readonly CatalogBinding[]) {
    const row = this.selectObject(sql, bind);
    return row ? Object.values(row)[0] : undefined;
  }
  selectValues(sql: string, bind?: readonly CatalogBinding[]) {
    return this.selectObjects(sql, bind).map((row) => Object.values(row)[0]);
  }
  prepare(sql: string) {
    return new NativeStatement(this.db.prepare(sql));
  }
  transaction<T>(action: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  savepoint<T>(action: () => T) {
    const name = `catalog_${++this.sequence}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = action();
      this.db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw error;
    }
  }
  changes() {
    return Number(this.selectValue("SELECT changes()"));
  }
  close() {
    this.db.close();
  }
}
class NativeStatement implements CatalogStatement {
  private values: SQLInputValue[] = [];
  private rows: ReturnType<StatementSync["iterate"]> | undefined;
  private row: Record<string, CatalogValue> | undefined;
  constructor(private statement: StatementSync) {}
  bind(values: readonly CatalogBinding[]) {
    this.reset();
    this.values = bindings(values);
    return this;
  }
  step() {
    this.rows ??= this.statement.iterate(...this.values);
    const next = this.rows.next();
    this.row = next.done ? undefined : next.value;
    return !next.done;
  }
  get(target: Record<string, CatalogValue>) {
    if (!this.row) throw new Error("Read a positioned catalog statement.");
    return Object.assign(target, this.row);
  }
  reset() {
    this.rows?.return?.();
    this.rows = undefined;
    this.row = undefined;
  }
  finalize() {
    this.reset();
  }
}
function bindings(values: readonly CatalogBinding[] = []): SQLInputValue[] {
  return values.map(binding);
}
function binding(value: CatalogBinding): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return Number(value);
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

import type { SqlValue, BindableValue } from "@sqlite.org/sqlite-wasm";
export type { SqlValue, BindableValue } from "@sqlite.org/sqlite-wasm";

/** SQL operations used by the canonical catalog, independent of OPFS or native file access. */
export interface Database {
  exec(sql: string): unknown;
  exec(options: {
    sql: string;
    bind?: readonly BindableValue[] | Record<string, BindableValue>;
  }): unknown;
  selectObject(sql: string, bind?: readonly BindableValue[]): Record<string, SqlValue> | undefined;
  selectObjects(sql: string, bind?: readonly BindableValue[]): Record<string, SqlValue>[];
  selectValue(sql: string, bind?: readonly BindableValue[]): SqlValue | undefined;
  selectValues(sql: string, bind?: readonly BindableValue[]): SqlValue[];
  prepare(sql: string): Statement;
  transaction<T>(action: () => T): T;
  savepoint<T>(action: () => T): T;
  changes(): number;
  close(): void;
}
export interface Statement {
  bind(values: readonly BindableValue[]): Statement;
  step(): boolean;
  get(target: Record<string, SqlValue>): Record<string, SqlValue>;
  reset(): unknown;
  finalize(): void;
}

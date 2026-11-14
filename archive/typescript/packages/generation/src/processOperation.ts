/** Executable process definitions. Implementations are private to the execution boundary. */
const implementation = Symbol("process implementation");
const strategies = Symbol("selected query strategies");
export type OperationKind = "query" | "initialize" | "work" | "elapsed" | "event" | "publish";
export interface Operation<Input, Result extends void | Promise<void> = void | Promise<void>> {
  readonly id: string;
  readonly kind: OperationKind;
  readonly dependencies: readonly Query<Input>[];
  readonly [implementation]: (input: Input) => Result;
}
export interface Query<Input> extends Operation<Input, void> {
  readonly kind: "query";
  readonly [strategies]: WeakMap<object, (input: Input) => void>;
}
export interface Command<
  Input,
  Result extends void | Promise<void> = void | Promise<void>,
> extends Operation<Input, Result> {
  readonly kind: Exclude<OperationKind, "query">;
}
export function defineQuery<Input>(
  id: string,
  read: (input: Input) => void,
  dependencies: readonly Query<Input>[]
): Query<Input> {
  return { id, kind: "query", dependencies, [implementation]: read, [strategies]: new WeakMap() };
}
export function defineCommand<Input, Result extends void | Promise<void>>(
  id: string,
  kind: Exclude<OperationKind, "query">,
  execute: (input: Input) => Result,
  dependencies: readonly Query<Input>[]
): Command<Input, Result> {
  return { id, kind, dependencies, [implementation]: execute };
}
interface ReadMemo {
  revision: number;
  reading: boolean;
}
interface ExecutionScope {
  revision: number;
  reads: WeakMap<object, ReadMemo>;
  batch: number;
  changed: boolean;
  readDepth: number;
}
const scopes = new WeakMap<object, ExecutionScope>();
function scopeOf(owner: object) {
  let scope = scopes.get(owner);
  if (!scope) {
    scope = { revision: 0, reads: new WeakMap(), batch: 0, changed: false, readDepth: 0 };
    scopes.set(owner, scope);
  }
  return scope;
}
export const processRevision = (owner: object) => scopeOf(owner).revision;
/** Mutation boundaries invalidate derived reads; domain consumers cannot mark individual caches. */
export function invalidateProcesses(owner: object) {
  const scope = scopeOf(owner);
  requireCommandScope(scope);
  if (scope.batch) scope.changed = true;
  else scope.revision++;
}
/** A simultaneous material stage exposes one settled mutation boundary. */
export function commandBatch(owner: object, settle: () => void) {
  const scope = scopeOf(owner);
  requireCommandScope(scope);
  scope.batch++;
  try {
    settle();
  } finally {
    scope.batch--;
    if (!scope.batch && scope.changed) {
      scope.changed = false;
      scope.revision++;
    }
  }
}
/** Selected strategies keep the owner's executable dependencies. */
export function bindOperation<Input>(
  owner: object,
  query: Query<Input>,
  read: (input: Input) => void = query[implementation]
) {
  query[strategies].set(owner, read);
  scopeOf(owner).reads.delete(query);
}
/** Select a default once; an installed map strategy remains authoritative. */
export function selectOperation<Input>(
  owner: object,
  query: Query<Input>,
  inputs: (input: Input) => Input = (input) => input
) {
  if (!query[strategies].has(owner))
    bindOperation(owner, query, (input) => query[implementation](inputs(input)));
}
export function readOperation<Input>(owner: object, query: Query<Input>, input: Input) {
  const scope = scopeOf(owner);
  const read = query[strategies].get(owner);
  if (!read) return;
  let memo = scope.reads.get(query);
  if (!memo) {
    memo = { revision: -1, reading: false };
    scope.reads.set(query, memo);
  }
  if (memo.revision === scope.revision) return;
  if (memo.reading) throw new Error(`Cyclic derived query: ${query.id}`);
  memo.reading = true;
  scope.readDepth++;
  try {
    for (const dependency of query.dependencies) readOperation(owner, dependency, input);
    read(input);
    memo.revision = scope.revision;
  } finally {
    memo.reading = false;
    scope.readDepth--;
  }
}
export function runOperation<Input>(
  owner: object,
  operation: Command<Input, void>,
  input: Input
): void;
export function runOperation<Input>(
  owner: object,
  operation: Command<Input>,
  input: Input
): void | Promise<void>;
export function runOperation<Input>(
  owner: object,
  operation: Command<Input>,
  input: Input
): void | Promise<void> {
  requireCommandScope(scopeOf(owner));
  for (const dependency of operation.dependencies) readOperation(owner, dependency, input);
  try {
    const result = operation[implementation](input);
    if (result) return result.finally(() => invalidateProcesses(owner));
    invalidateProcesses(owner);
  } catch (error) {
    invalidateProcesses(owner);
    throw error;
  }
}

function requireCommandScope(scope: ExecutionScope) {
  if (scope.readDepth > 0)
    throw new Error("A current query cannot dispatch a material or lifecycle command.");
}

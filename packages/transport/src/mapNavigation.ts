import type {
  MapNavigation,
  MapNavigationState,
  MapRef,
  NavigationChange,
  RegionQuery,
  RegionDrawing,
  ReadOptions,
} from "@atlas/map";

interface Arguments {
  read: [MapRef];
  commit: [MapRef, MapNavigationState, NavigationChange];
  choices: [MapRef, MapNavigationState, RegionQuery];
  draw: [MapRef, MapNavigationState, RegionDrawing];
}
type Method = keyof Arguments;
export type NavigationCall = { [M in Method]: { method: M; args: Arguments[M] } }[Method];
export type NavigationTransport = (call: NavigationCall, options?: ReadOptions) => Promise<unknown>;

export class RpcMapNavigation implements MapNavigation {
  constructor(private send: NavigationTransport) {}
  private call<M extends Method>(method: M, args: Arguments[M], options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.send({ method, args } as NavigationCall, options) as ReturnType<MapNavigation[M]>;
  }
  read(reference: MapRef, options?: ReadOptions) {
    return this.call("read", [reference], options);
  }
  commit(
    reference: MapRef,
    state: MapNavigationState,
    change: NavigationChange,
    options?: ReadOptions
  ) {
    return this.call("commit", [reference, state, change], options);
  }
  choices(reference: MapRef, state: MapNavigationState, query: RegionQuery, options?: ReadOptions) {
    return this.call("choices", [reference, state, query], options);
  }
  draw(
    reference: MapRef,
    state: MapNavigationState,
    drawing: RegionDrawing,
    options?: ReadOptions
  ) {
    return this.call("draw", [reference, state, drawing], options);
  }
}
export async function dispatchMapNavigation(
  navigation: MapNavigation,
  input: unknown,
  options?: ReadOptions
) {
  const call = parseNavigationCall(input);
  options?.signal?.throwIfAborted();
  const method = navigation[call.method] as (...args: unknown[]) => Promise<unknown>;
  return method.apply(navigation, [...call.args, options]);
}
function parseNavigationCall(input: unknown): NavigationCall {
  const arity = { read: 1, commit: 3, choices: 3, draw: 3 };
  if (!input || typeof input !== "object") throw new Error("A map navigation request is required.");
  const call = input as Partial<NavigationCall>;
  if (
    !call.method ||
    !Object.hasOwn(arity, call.method) ||
    !Array.isArray(call.args) ||
    call.args.length !== arity[call.method]
  )
    throw new Error("Unknown map navigation operation or arguments.");
  requireReference(call.args[0]);
  return call as NavigationCall;
}
function requireReference(reference: MapRef) {
  if (
    !reference ||
    typeof reference.mapId !== "string" ||
    !reference.mapId ||
    typeof reference.revision !== "string" ||
    !reference.revision
  )
    throw new Error("Choose a map revision.");
}

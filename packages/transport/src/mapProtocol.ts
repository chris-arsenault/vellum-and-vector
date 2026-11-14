import type {
  MapRef,
  MapReader,
  FeatureQuery,
  InspectionRequest,
  SelectionRequest,
  MapRegistryRequest,
  ReadOptions,
  GeometryQuery,
  CoverageRequest,
  Geometry,
} from "@atlas/map";

export interface MapArguments {
  open: [MapRef];
  layers: [MapRef];
  entities: [MapRef, string[]];
  registry: [MapRef, MapRegistryRequest];
  settlement: [MapRef, string];
  features: [MapRef, FeatureQuery];
  inspect: [MapRef, InspectionRequest];
  history: [MapRef, string | undefined];
  selectRegion: [MapRef, SelectionRequest];
  illustration: [MapRef];
  geometries: [MapRef, string, GeometryQuery[]];
  coverage: [MapRef, CoverageRequest];
  areas: [MapRef, string, Geometry[]];
  asset: [MapRef, string];
  source: [MapRef, string];
  export: [MapRef, string];
}
export type MapMethod = keyof MapArguments;
export type MapCall = { [M in MapMethod]: { method: M; args: MapArguments[M] } }[MapMethod];
export type MapTransport = (call: MapCall, options?: ReadOptions) => Promise<unknown>;

const arity: Record<MapMethod, number> = {
  open: 1,
  layers: 1,
  entities: 2,
  registry: 2,
  settlement: 2,
  features: 2,
  inspect: 2,
  history: 2,
  selectRegion: 2,
  illustration: 1,
  geometries: 3,
  coverage: 2,
  areas: 3,
  asset: 2,
  source: 2,
  export: 2,
};
export function parseMapCall(value: unknown): MapCall {
  if (!value || typeof value !== "object") throw new Error("A map request is required.");
  const call = value as Partial<MapCall>;
  if (
    typeof call.method !== "string" ||
    !Object.hasOwn(arity, call.method) ||
    !Array.isArray(call.args) ||
    call.args.length !== arity[call.method]
  )
    throw new Error("Unknown map operation or arguments.");
  const reference = call.args[0];
  requireReference(reference);
  return call as MapCall;
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
export async function dispatchMapRead(reader: MapReader, input: unknown, options?: ReadOptions) {
  const call = parseMapCall(input);
  options?.signal?.throwIfAborted();
  const method = reader[call.method] as (...args: unknown[]) => Promise<unknown>;
  return method.apply(reader, [...call.args, options]);
}

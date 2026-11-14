import type {
  MapReader,
  MapRef,
  FeatureQuery,
  InspectionRequest,
  SelectionRequest,
  MapRegistryRequest,
  ReadOptions,
  GeometryQuery,
  CoverageRequest,
  Geometry,
} from "@atlas/map";
import type { MapCall, MapTransport, MapMethod, MapArguments } from "./mapProtocol";

/** One typed facade works over a browser-worker call or the selected backend's HTTP transport. */
export class RpcMapReader implements MapReader {
  constructor(private send: MapTransport) {}
  private call<M extends MapMethod>(method: M, args: MapArguments[M], options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.send({ method, args } as MapCall, options) as ReturnType<MapReader[M]>;
  }
  open(reference: MapRef, options?: ReadOptions) {
    return this.call("open", [reference], options);
  }
  layers(reference: MapRef, options?: ReadOptions) {
    return this.call("layers", [reference], options);
  }
  entities(reference: MapRef, ids: string[], options?: ReadOptions) {
    return this.call("entities", [reference, ids], options);
  }
  registry(reference: MapRef, request: MapRegistryRequest, options?: ReadOptions) {
    return this.call("registry", [reference, request], options);
  }
  settlement(reference: MapRef, id: string, options?: ReadOptions) {
    return this.call("settlement", [reference, id], options);
  }
  features(reference: MapRef, query: FeatureQuery, options?: ReadOptions) {
    return this.call("features", [reference, query], options);
  }
  inspect(reference: MapRef, request: InspectionRequest, options?: ReadOptions) {
    return this.call("inspect", [reference, request], options);
  }
  history(reference: MapRef, cursor?: string, options?: ReadOptions) {
    return this.call("history", [reference, cursor], options);
  }
  selectRegion(reference: MapRef, request: SelectionRequest, options?: ReadOptions) {
    return this.call("selectRegion", [reference, request], options);
  }
  illustration(reference: MapRef, options?: ReadOptions) {
    return this.call("illustration", [reference], options);
  }
  geometries(reference: MapRef, spaceId: string, queries: GeometryQuery[], options?: ReadOptions) {
    return this.call("geometries", [reference, spaceId, queries], options);
  }
  areas(reference: MapRef, spaceId: string, polygons: Geometry[], options?: ReadOptions) {
    return this.call("areas", [reference, spaceId, polygons], options);
  }
  coverage(reference: MapRef, request: CoverageRequest, options?: ReadOptions) {
    return this.call("coverage", [reference, request], options);
  }
  asset(reference: MapRef, id: string, options?: ReadOptions) {
    return this.call("asset", [reference, id], options);
  }
  source(reference: MapRef, id: string, options?: ReadOptions) {
    return this.call("source", [reference, id], options);
  }
  export(reference: MapRef, format: string, options?: ReadOptions) {
    return this.call("export", [reference, format], options);
  }
}

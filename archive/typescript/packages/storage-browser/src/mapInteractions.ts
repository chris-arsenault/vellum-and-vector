import type {
  Geometry,
  HistoryEntry,
  Inspection,
  InspectionRequest,
  MapFeature,
  MapRef,
  Page,
  RegionSelection,
  SelectionRequest,
} from "@atlas/map";
import type { GeometryKernel } from "./geometryKernel";
import type { MapCatalog } from "./mapCatalog";
import {
  mapSpace,
  mapPosition,
  pickingGeometry,
  inspectionResult,
  regionGeometry,
} from "@atlas/map";

/** Interaction replies are assembled exclusively from the pinned published map revision. */
export class MapInteractions {
  constructor(
    private maps: MapCatalog,
    private kernel: GeometryKernel
  ) {}

  inspect(reference: MapRef, request: InspectionRequest): Inspection {
    const space = mapSpace(this.maps.open(reference), request.spaceId);
    const position = mapPosition(space, request.position);
    const samples = this.maps.samplesAt(reference, space.id, position);
    const point: Geometry = { type: "Point", coordinates: position };
    const geometry = pickingGeometry(position, samples, request.tolerance);
    const candidates = allPages((cursor) =>
      this.maps.features(reference, {
        spaceId: request.spaceId,
        geometry: geometry as Geometry,
        layerIds: request.layerIds,
        featureIds: request.featureIds,
        cursor,
      })
    );
    const features = this.kernel.withShape(point, space.precision, (point) =>
      candidates.filter((feature) => this.coversPoint(feature, point, space.precision))
    );
    return inspectionResult(
      reference,
      request,
      position,
      features,
      samples,
      this.causes(reference, features)
    );
  }

  private coversPoint(feature: MapFeature, point: number, precision: number) {
    if (!feature.geometry.type.includes("Polygon")) return true;
    return this.kernel.withShape(feature.footprint ?? feature.geometry, precision, (geometry) => {
      const covered = this.kernel.native.GEOSCovers(geometry, point);
      if (covered === 2) throw new Error("Cannot inspect feature geography.");
      return covered === 1;
    });
  }

  selectRegion(reference: MapRef, request: SelectionRequest): RegionSelection {
    const map = this.maps.open(reference);
    const space = mapSpace(map, request.spaceId);
    const ids = [...new Set(request.featureIds ?? [])];
    const selected = allPages((cursor) =>
      this.maps.features(reference, {
        spaceId: space.id,
        featureIds: ids,
        cursor,
      })
    );
    if (selected.length !== ids.length)
      throw new Error("Selected features are absent from this map revision.");
    let shape = request.geometry;
    if (!shape) {
      for (const feature of selected) {
        const polygon = regionGeometry(feature.geometry);
        shape = shape
          ? regionGeometry(this.kernel.overlay(shape, polygon, space.precision, "union"))
          : polygon;
      }
    }
    if (!shape) throw new Error("Choose an outline or a polygon feature.");
    const geometry = regionGeometry(this.kernel.canonical(shape, space.precision));
    return { parent: { ...reference }, spaceId: space.id, geometry, featureIds: ids };
  }

  private causes(reference: MapRef, features: MapFeature[]): HistoryEntry[] {
    return allPages((cursor) =>
      this.maps.history(
        reference,
        cursor,
        features.map((feature) => feature.id)
      )
    );
  }
}
function allPages<T>(read: (cursor?: string) => Page<T>) {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = read(cursor);
    values.push(...page.items);
    cursor = page.next ?? undefined;
  } while (cursor);
  return values;
}

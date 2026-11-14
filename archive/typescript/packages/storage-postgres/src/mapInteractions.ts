import {
  mapSpace,
  mapPosition,
  pickingGeometry,
  inspectionResult,
  regionGeometry,
  collectPages,
  type InspectionRequest,
  type SelectionRequest,
  type MapRef,
  type RegionSelection,
  type Geometry,
} from "@atlas/map";
import type { PostgresMapCatalog } from "./mapCatalog";
import type { SqlReader } from "./database";

export class PostgresMapInteractions {
  constructor(
    private maps: PostgresMapCatalog,
    private database: SqlReader
  ) {}

  async inspect(reference: MapRef, request: InspectionRequest) {
    const space = mapSpace(await this.maps.open(reference), request.spaceId);
    const position = mapPosition(space, request.position);
    const samples = await this.maps.samplesAt(reference, space.id, position);
    const geometry = pickingGeometry(position, samples, request.tolerance);
    const features = await collectPages((cursor) =>
      this.maps.features(
        reference,
        {
          spaceId: space.id,
          geometry,
          layerIds: request.layerIds,
          featureIds: request.featureIds,
          cursor,
        },
        position
      )
    );
    const causes = await collectPages((cursor) =>
      this.maps.history(
        reference,
        cursor,
        features.map((f) => f.id)
      )
    );
    return inspectionResult(reference, request, position, features, samples, causes);
  }

  async selectRegion(reference: MapRef, request: SelectionRequest): Promise<RegionSelection> {
    const space = mapSpace(await this.maps.open(reference), request.spaceId);
    const ids = [...new Set(request.featureIds ?? [])];
    const features = await collectPages((cursor) =>
      this.maps.features(reference, {
        spaceId: space.id,
        featureIds: ids,
        cursor,
      })
    );
    if (features.length !== ids.length)
      throw new Error("Selected features are absent from this map revision.");
    const shapes = request.geometry
      ? [request.geometry]
      : features.map((f) => regionGeometry(f.geometry));
    if (!shapes.length) throw new Error("Choose an outline or a polygon feature.");
    const { rows } = await this.database.query<{ geometry: Geometry }>(
      `SELECT ST_AsGeoJSON(ST_UnaryUnion(ST_Collect(map.canonical_geometry(value::text,$2)),$2),15,0)::json AS geometry
       FROM jsonb_array_elements($1::jsonb)`,
      [JSON.stringify(shapes), space.precision]
    );
    return {
      parent: { ...reference },
      spaceId: space.id,
      geometry: regionGeometry(rows[0].geometry),
      featureIds: ids,
    };
  }
}

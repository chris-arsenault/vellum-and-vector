import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry } from "geojson";
import {
  requireThat,
  type FieldGeography,
  type WorkspaceScope,
  type WaterBody,
  type Bounds,
} from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import type { GeometryDerivations } from "./geometryDerivations";

interface ShapeReference {
  type: Geometry["type"];
  parts: number[];
}
type StoredBody = Omit<WaterBody, "footprint" | "slices"> & {
  footprint: ShapeReference;
  slices: (Omit<WaterBody["slices"][number], "footprint"> & { footprint: ShapeReference | null })[];
};
interface StoredGeography {
  ocean?: ShapeReference | null;
  waterBodies?: StoredBody[] | null;
  lakes?: { id: string; geometry: ShapeReference; level: number }[];
}
/** Immutable physical geography is indexed GIS data, separate from numerical chunk metadata. */
export class FieldGeographyCatalog {
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private derivations: GeometryDerivations
  ) {}
  write(geography: FieldGeography, precision: number) {
    const { scope, id } = geography;
    requireThat(
      this.db.selectValue(
        `SELECT 1 FROM resources WHERE id=? AND world_id=?
      AND json_extract(data,'$.scope.spaceId')=? AND json_extract(data,'$.scope.areaId')=?`,
        [id, scope.worldId, scope.spaceId, scope.areaId]
      ),
      "field_geography_resource",
      "Publish the located numerical layout before its geography."
    );
    requireThat(
      !this.db.selectValue("SELECT 1 FROM field_geography WHERE world_id=? AND id=?", [
        scope.worldId,
        id,
      ]),
      "field_geography_immutable",
      "Field geography is immutable; publish a new resource identity."
    );
    this.db.exec({
      sql: "INSERT INTO field_geography VALUES(?,?,?,?,?)",
      bind: [scope.worldId, id, scope.spaceId, scope.areaId, "{}"],
    });
    const shape = (geometry: Geometry, role: string) =>
      this.storeShape(scope.worldId, id, geometry, role, precision);
    const data: StoredGeography = {
      ocean: geography.ocean ? shape(geography.ocean, "ocean") : geography.ocean,
      lakes: geography.lakes?.map((lake) => ({ ...lake, geometry: shape(lake.geometry, "lake") })),
      waterBodies: geography.waterBodies
        ? geography.waterBodies.map((body) => ({
            ...body,
            footprint: shape(body.footprint, "water"),
            slices: body.slices.map((slice) => ({
              ...slice,
              footprint: slice.footprint ? shape(slice.footprint, "slice") : null,
            })),
          }))
        : geography.waterBodies,
    };
    this.db.exec({
      sql: "UPDATE field_geography SET data=? WHERE world_id=? AND id=?",
      bind: [JSON.stringify(data), scope.worldId, id],
    });
  }
  private storeShape(
    worldId: string,
    id: string,
    geometry: Geometry,
    role: string,
    precision: number
  ): ShapeReference {
    const parts: Geometry[] =
      geometry.type === "MultiPolygon"
        ? geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }))
        : [geometry];
    return {
      type: geometry.type,
      parts: parts.map((part) => {
        const value = this.kernel.encode(part, precision),
          [x0, y0, x1, y1] = value.bounds;
        this.db.exec({ sql: "INSERT INTO geometry_values(data) VALUES(?)", bind: [value.bytes] });
        const geometryId = this.db.selectValue("SELECT last_insert_rowid()")!;
        this.db.exec({
          sql: "INSERT INTO field_geometry_parts(world_id,geography_id,role,geometry_id) VALUES(?,?,?,?)",
          bind: [worldId, id, role, geometryId],
        });
        const partId = Number(this.db.selectValue("SELECT last_insert_rowid()"));
        this.db.exec({
          sql: "INSERT INTO field_geometry_bounds VALUES(?,?,?,?,?)",
          bind: [partId, x0, x1, y0, y1],
        });
        return partId;
      }),
    };
  }
  read(scope: WorkspaceScope, id: string, extent?: Bounds): FieldGeography {
    const row = this.db.selectObject(
      "SELECT data FROM field_geography WHERE world_id=? AND space_id=? AND area_id=? AND id=?",
      [scope.worldId, scope.spaceId, scope.areaId, id]
    );
    requireThat(row, "field_geography", "Field geography belongs to this located resource.");
    const data = JSON.parse(String(row.data)) as StoredGeography;
    const selected =
      extent &&
      new Set(
        this.db
          .selectObjects(
            `SELECT p.part_id FROM field_geometry_parts p JOIN field_geometry_bounds b USING(part_id)
       WHERE p.world_id=? AND p.geography_id=?
       AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?`,
            [scope.worldId, id, extent[2], extent[0], extent[3], extent[1]]
          )
          .map((part) => Number(part.part_id))
      );
    const shape = (reference: ShapeReference) => {
      const parts = selected
        ? reference.parts.filter((part) => selected.has(part))
        : reference.parts;
      return parts.length ? this.readShape(scope.worldId, id, { ...reference, parts }) : null;
    };
    return {
      id,
      scope,
      ocean: data.ocean ? shape(data.ocean) : data.ocean,
      lakes: data.lakes?.flatMap((lake) => {
        const geometry = shape(lake.geometry);
        return geometry ? [{ ...lake, geometry }] : [];
      }),
      waterBodies: data.waterBodies
        ? data.waterBodies.flatMap((body) => {
            const footprint = shape(body.footprint);
            return footprint
              ? [
                  {
                    ...body,
                    footprint,
                    slices: body.slices.map((slice) => ({
                      ...slice,
                      footprint: slice.footprint ? shape(slice.footprint) : null,
                    })),
                  },
                ]
              : [];
          })
        : data.waterBodies,
    };
  }
  window(scope: WorkspaceScope, id: string, extent: Bounds, tolerance = 0): FieldGeography {
    const precision =
      Number(
        this.db.selectValue(
          "SELECT json_extract(data,'$.reference.precision') FROM worlds WHERE id=?",
          [scope.worldId]
        )
      ) || 1e-6;
    const lakes = this.lakeWindow(scope, id, extent, tolerance, precision);
    const ocean = this.db.selectValue(
      `SELECT json_type(data,'$.ocean') FROM field_geography
      WHERE world_id=? AND space_id=? AND area_id=? AND id=?`,
      [scope.worldId, scope.spaceId, scope.areaId, id]
    );
    if (ocean === undefined || ocean === null) return { id, scope, lakes };
    if (ocean === "null") return { id, scope, ocean: null, lakes };
    const rows = this.db.selectObjects(
      `SELECT p.geometry_id FROM field_geometry_parts p
      JOIN field_geometry_bounds b USING(part_id)
      WHERE p.world_id=? AND p.geography_id=? AND p.role='ocean'
      AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?`,
      [scope.worldId, id, extent[2], extent[0], extent[3], extent[1]]
    );
    const pieces = rows.flatMap((row) => {
      const clipped = this.derivations.window(
        Number(row.geometry_id),
        extent,
        precision,
        tolerance
      );
      return clipped?.type === "Polygon"
        ? [clipped.coordinates]
        : clipped?.type === "MultiPolygon"
          ? clipped.coordinates
          : [];
    });
    return {
      id,
      scope,
      lakes,
      ocean: pieces.length ? { type: "MultiPolygon", coordinates: pieces } : null,
    };
  }
  private lakeWindow(
    scope: WorkspaceScope,
    id: string,
    extent: Bounds,
    tolerance: number,
    precision: number
  ) {
    const rows = this.db.selectObjects(
      `SELECT json_extract(l.value,'$.id') AS lake_id,
        json_extract(l.value,'$.level') AS level, p.geometry_id
      FROM field_geography g, json_each(g.data,'$.lakes') l,
        json_each(l.value,'$.geometry.parts') ids
      JOIN field_geometry_parts p ON p.part_id=ids.value
      JOIN field_geometry_bounds b ON b.part_id=p.part_id
      WHERE g.world_id=? AND g.space_id=? AND g.area_id=? AND g.id=?
        AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?`,
      [scope.worldId, scope.spaceId, scope.areaId, id, extent[2], extent[0], extent[3], extent[1]]
    );
    return rows.flatMap((row) => {
      const geometry = this.derivations.window(
        Number(row.geometry_id),
        extent,
        precision,
        tolerance
      );
      return geometry ? [{ id: String(row.lake_id), level: Number(row.level), geometry }] : [];
    });
  }
  private readShape(worldId: string, id: string, reference: ShapeReference): Geometry {
    const parts = reference.parts.map((part) => {
      const row = this.db.selectObject(
        `SELECT g.data FROM field_geometry_parts p JOIN geometry_values g ON g.geometry_id=p.geometry_id
        WHERE p.world_id=? AND p.geography_id=? AND p.part_id=?`,
        [worldId, id, part]
      );
      requireThat(
        row?.data instanceof Uint8Array,
        "field_geography",
        "Stored field geometry is unavailable."
      );
      return this.kernel.decode(row.data);
    });
    if (reference.type !== "MultiPolygon") return parts[0];
    return {
      type: "MultiPolygon",
      coordinates: parts.map((part) => {
        requireThat(
          part.type === "Polygon",
          "field_geography",
          "Ocean pieces retain their polygon geometry."
        );
        return part.coordinates;
      }),
    };
  }
}

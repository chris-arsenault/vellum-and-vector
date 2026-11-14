import type {
  Geometry,
  HistoryEntry,
  Inspection,
  MapFeature,
  MapRef,
  MapSample,
  Position,
  RegionGeometry,
} from "./generated";
import type { InspectionRequest, Page } from "./services";

export function pickingGeometry(
  position: Position,
  samples: MapSample[],
  tolerance?: number
): Geometry {
  tolerance ??= samples.length ? Math.min(...samples.map((sample) => sample.cellSpan)) / 2 : 0;
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error("Picking tolerance must be a finite nonnegative distance.");
  if (!tolerance) return { type: "Point", coordinates: position };
  const [x, y] = position;
  const [w, s, e, n] = [x - tolerance, y - tolerance, x + tolerance, y + tolerance];
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

export function inspectionResult(
  reference: MapRef,
  request: InspectionRequest,
  position: Position,
  features: MapFeature[],
  samples: MapSample[],
  causes: HistoryEntry[]
): Inspection {
  features.sort(
    (a, b) => featureRank(a) - featureRank(b) || (a.name ?? "").localeCompare(b.name ?? "")
  );
  return {
    reference,
    spaceId: request.spaceId,
    position,
    features,
    samples: samples.flatMap((sample) =>
      sample.attributes
        .filter((value) => !request.layerIds || request.layerIds.includes(value.layerId))
        .map((value) => ({
          ...value,
          sampleId: sample.id,
          footprint: sample.footprint,
          bounds: sample.window.bounds,
          cellSpan: sample.cellSpan,
          center: sample.center,
          measure: sample.measure,
          active: sample.active,
        }))
    ),
    sections: samples.flatMap((sample) => sample.sections),
    causes,
  };
}
function featureRank(feature: MapFeature) {
  return feature.geometry.type.includes("Point")
    ? 0
    : feature.geometry.type.includes("Line")
      ? 1
      : 2;
}
export function regionGeometry(value: unknown): RegionGeometry {
  const shape = value as Geometry | null;
  if (!shape || (shape.type !== "Polygon" && shape.type !== "MultiPolygon"))
    throw new Error("A region needs polygon geography.");
  return shape;
}
export async function collectPages<T>(read: (cursor?: string) => Page<T> | Promise<Page<T>>) {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    values.push(...page.items);
    cursor = page.next ?? undefined;
  } while (cursor);
  return values;
}

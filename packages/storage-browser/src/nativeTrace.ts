import type { Geometry, LineString, MultiLineString, Position } from "geojson";
import { requireThat } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";

/** Native traces retain stations, including repetitions that a topological overlay would dissolve. */
function withLine<T>(kernel: GeometryKernel, coordinates: Position[], work: (line: number) => T) {
  const g = kernel.native,
    dimensions = coordinates[0].length > 2 ? 3 : 2,
    sequence = g.GEOSCoordSeq_create(coordinates.length, dimensions);
  requireThat(sequence, "geometry_trace", "Could not allocate trace coordinates.");
  let line = 0,
    ownsSequence = true;
  try {
    for (let i = 0; i < coordinates.length; i++) {
      for (let d = 0; d < dimensions; d++) {
        const value = d < 2 ? coordinates[i][d] : (coordinates[i][d] ?? 0);
        requireThat(
          Number.isFinite(value),
          "invalid_geometry",
          "Trace coordinates must be finite."
        );
        requireThat(
          g.GEOSCoordSeq_setOrdinate(sequence, i, d, value),
          "geometry_trace",
          "Could not write trace coordinates."
        );
      }
    }
    // GEOS takes sequence ownership even when its line constructor fails.
    ownsSequence = false;
    line = g.GEOSGeom_createLineString(sequence);
    requireThat(line, "geometry_trace", "Could not construct a trace.");
    return work(line);
  } finally {
    if (line) g.GEOSGeom_destroy(line);
    else if (ownsSequence) g.GEOSCoordSeq_destroy(sequence);
  }
}

function normalized(kernel: GeometryKernel, coordinates: Position[], precision: number) {
  requireThat(coordinates.length >= 2, "invalid_geometry", "A trace needs at least two stations.");
  return withLine(kernel, coordinates, (line) => {
    // GEOS_PREC_NO_TOPO: round coordinates without deleting repeated stations or noding crossings.
    const g = kernel.native,
      result = g.GEOSGeom_setPrecision(line, precision, 1);
    requireThat(result, "geometry_trace", "Could not normalize trace precision.");
    try {
      return (kernel.json(result) as LineString).coordinates;
    } finally {
      g.GEOSGeom_destroy(result);
    }
  });
}

/** Trace detail follows its physical sampling scale, without turning self-crossings into nodes. */
export function resampleTrace(
  kernel: GeometryKernel,
  value: LineString,
  deviation: number,
  spacing: number | undefined,
  precision: number
): LineString {
  requireThat(value.coordinates.length >= 2, "invalid_geometry", "A trace needs two stations.");
  requireThat(
    Number.isFinite(deviation) && deviation >= 0,
    "trace_resolution",
    "Trace deviation must be finite and nonnegative."
  );
  requireThat(
    spacing === undefined || (Number.isFinite(spacing) && spacing > 0),
    "trace_resolution",
    "Trace spacing must be finite and positive."
  );
  return withLine(kernel, value.coordinates, (line) => {
    const g = kernel.native;
    let reduced = 0,
      sampled = 0,
      rounded = 0;
    try {
      reduced = g.GEOSSimplify(line, deviation);
      requireThat(reduced, "geometry_trace", "Could not reduce trace detail.");
      if (spacing !== undefined && traceLength(kernel, reduced) > 0) {
        sampled = g.GEOSDensify(reduced, spacing);
        requireThat(sampled, "geometry_trace", "Could not sample the trace.");
      }
      rounded = g.GEOSGeom_setPrecision(sampled || reduced, precision, 1);
      requireThat(rounded, "geometry_trace", "Could not normalize trace precision.");
      const result = kernel.json(rounded);
      requireThat(
        result.type === "LineString",
        "geometry_trace",
        "Trace resampling must retain a line."
      );
      return result as LineString;
    } finally {
      if (rounded) g.GEOSGeom_destroy(rounded);
      if (sampled) g.GEOSGeom_destroy(sampled);
      if (reduced) g.GEOSGeom_destroy(reduced);
    }
  });
}

function traceLength(kernel: GeometryKernel, line: number) {
  const g = kernel.native,
    output = g.Module._malloc(8);
  try {
    requireThat(g.GEOSLength(line, output), "geometry_trace", "Could not measure trace length.");
    return g.Module.getValue(output, "double");
  } finally {
    g.Module._free(output);
  }
}

function pieces(geometry: Geometry): (LineString | { type: "Point"; coordinates: Position })[] {
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(pieces);
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
  if (geometry.type === "MultiPoint")
    return geometry.coordinates.map((coordinates) => ({ type: "Point", coordinates }));
  return geometry.type === "Point" || geometry.type === "LineString" ? [geometry] : [];
}

function orderedIntersection(
  kernel: GeometryKernel,
  line: number,
  mask: number,
  precision: number
) {
  const g = kernel.native,
    result = g.GEOSIntersectionPrec(line, mask, precision);
  requireThat(result, "geometry_trace", "Could not clip a trace segment.");
  try {
    if (g.GEOSisEmpty(result)) return [];
    const project = (coordinates: Position) =>
      kernel.withShape({ type: "Point", coordinates }, precision, (point) => {
        const distance = g.GEOSProject(line, point);
        requireThat(distance >= 0, "geometry_trace", "Could not order clipped trace pieces.");
        return distance;
      });
    return pieces(kernel.json(result))
      .map((piece) => {
        if (piece.type === "Point") return { piece, position: project(piece.coordinates) };
        const start = project(piece.coordinates[0]),
          end = project(piece.coordinates.at(-1)!);
        if (start > end) piece.coordinates.reverse();
        return { piece, position: Math.min(start, end) };
      })
      .sort((a, b) => a.position - b.position)
      .map(({ piece }) => piece);
  } finally {
    g.GEOSGeom_destroy(result);
  }
}

function clippedParts(
  kernel: GeometryKernel,
  coordinates: Position[],
  mask: number,
  prepared: number,
  precision: number
): Geometry[] {
  return withLine(kernel, coordinates, (line) => {
    const g = kernel.native,
      covered = g.GEOSPreparedCovers(prepared, line);
    requireThat(covered !== 2, "geometry_predicate", "Trace coverage query failed.");
    if (covered) return [{ type: "LineString", coordinates }];
    const intersects = g.GEOSPreparedIntersects(prepared, line);
    requireThat(intersects !== 2, "geometry_predicate", "Trace intersection query failed.");
    if (!intersects) return [];
    if (coordinates.length === 2) return orderedIntersection(kernel, line, mask, precision);
    const middle = Math.floor(coordinates.length / 2);
    return [
      ...clippedParts(kernel, coordinates.slice(0, middle + 1), mask, prepared, precision),
      ...clippedParts(kernel, coordinates.slice(middle), mask, prepared, precision),
    ];
  });
}

/** Split only at existing stations. GEOS evaluates all geometry; no global line overlay is needed. */
export function clipTrace(
  kernel: GeometryKernel,
  value: LineString | MultiLineString,
  mask: Geometry,
  precision: number
): Geometry | null {
  return kernel.withGeometry(mask, precision, (area) => {
    const g = kernel.native,
      prepared = g.GEOSPrepare(area);
    requireThat(prepared, "geometry_trace", "Could not prepare the trace mask.");
    try {
      const lines = value.type === "LineString" ? [value.coordinates] : value.coordinates;
      const output = lines.flatMap((coordinates) =>
        clippedParts(kernel, normalized(kernel, coordinates, precision), area, prepared, precision)
      );
      if (!output.length) return null;
      if (output.length === 1) return output[0];
      if (output.every((part) => part.type === "LineString"))
        return { type: "MultiLineString", coordinates: output.map((part) => part.coordinates) };
      return { type: "GeometryCollection", geometries: output };
    } finally {
      g.GEOSPreparedGeom_destroy(prepared);
    }
  });
}

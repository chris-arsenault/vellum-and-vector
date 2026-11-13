import { lineParts, spatial } from "@atlas/domain";
import { groundOf } from "../rock/ground";
import { surfaceOpenness } from "../rock/groundQueries";
import type { PhysicalField } from "./field";
import { widenFracture } from "./fractures";
import { nearestTriangle } from "./mesh";
import { physicalFace } from "./physicalMetric";

type Fault = PhysicalField["faults"][number];

/** A captured coarse fracture opens into its surviving joints; this does not apply new strain. */
function opening(map: PhysicalField, cell: number) {
  const held = map.FractureConductance.get(cell),
    strain = map.TectonicStrain.get(cell) / 1000,
    joints = groundOf(map).fold(cell, surfaceOpenness);
  return held + (1000 - held) * strain * joints;
}

/** Realize retained traces at the current mesh, without spawning the world's tectonic roots. */
export function realizeFaults(map: PhysicalField, faults: readonly Fault[], contactWidth = 0) {
  for (const fault of faults) {
    const clipped = spatial.clipByRect(
      { type: "LineString", coordinates: fault.coordinates },
      map.mesh.bounds
    );
    if (!clipped) continue;
    const pieces = lineParts(clipped);
    pieces.forEach((coordinates, part) => {
      const line = spatial.resampleTrace(
        { type: "LineString", coordinates },
        0,
        map.mesh.spacing / 3
      );
      const readings = line.coordinates.map(([x, y]) =>
        opening(map, nearestTriangle(map.mesh, x, y))
      );
      line.coordinates.forEach(([x, y], at) =>
        widenFracture(map, [x, y], fault.width, readings[at])
      );
      map.faults.push({
        ...fault,
        id: part ? `${fault.id}:part:${part}` : fault.id,
        coordinates: coordinates.map(([x, y]) => [x, y]),
      });
    });
  }
  if (contactWidth > 0) resolveSheetContacts(map, contactWidth);
}

/** Retained sheet contacts are discontinuities, not a reason to lift the mountain again. */
export function resolveSheetContacts(map: PhysicalField, width: number) {
  const strength = Float64Array.from({ length: map.mesh.count }, (_, cell) => opening(map, cell));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (map.ThrustPairIds.get(cell) <= 0) continue;
    for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
      const next = map.mesh.neighbor(cell, edge);
      if (next < cell || !sheetContact(map, cell, next)) continue;
      const face = physicalFace(map.mesh, cell, edge);
      widenFracture(map, [face.x, face.y], width, (strength[cell] + strength[next]) / 2);
    }
  }
}
function sheetContact(map: PhysicalField, cell: number, next: number) {
  return (
    next >= 0 &&
    map.ThrustPairIds.get(next) === map.ThrustPairIds.get(cell) &&
    (map.ThrustSheetIndex.get(next) !== map.ThrustSheetIndex.get(cell) ||
      map.ThrustSegmentIds.get(next) !== map.ThrustSegmentIds.get(cell))
  );
}

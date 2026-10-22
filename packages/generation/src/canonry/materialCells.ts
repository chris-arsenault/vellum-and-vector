import { adaptiveCell, boundsIndex, rectangle, spatial, type Bounds } from "@atlas/domain";
import type { Geometry, Polygon } from "geojson";
import type { PhysicalMesh } from "./mesh";
import { affinePoint, type MaterialAffine } from "./materialAffine";
import type { MotionPiece } from "./motionPieces";
import { sourceInsideCell } from "./materialCollapse";

function controlVolume(mesh: PhysicalMesh, i: number): Polygon {
  if (mesh.topology) return rectangle(adaptiveCell(mesh.topology, mesh.cellToLeaf[i])) as Polygon;
  const coord = mesh.coords[i],
    s = mesh.spacing,
    sign = coord.inverted ? 1 : -1;
  const x =
    (1.5 * (coord.u + coord.v) + (coord.inverted ? 2 : 1)) * s +
    mesh.latticeOffset[0] +
    mesh.origin[0];
  const y =
    ((Math.sqrt(3) * (-coord.u + coord.v)) / 2) * s + mesh.latticeOffset[1] + mesh.origin[1];
  const ring = [
    [x + sign * s, y],
    [x - (sign * s) / 2, y + (Math.sqrt(3) * s) / 2],
    [x - (sign * s) / 2, y - (Math.sqrt(3) * s) / 2],
  ];
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}
interface Cell {
  id: number;
  geometry: Polygon;
  bounds: Bounds;
  area: number;
}
/** Integrate every donor, independently of the strongest history arrival. */
export function materialCellTransfers(mesh: PhysicalMesh, pieces: MotionPiece[]) {
  const cells: Cell[] = Array.from({ length: mesh.count }, (_, id) => {
    const geometry = controlVolume(mesh, id);
    return { id, geometry, bounds: spatial.bounds(geometry), area: spatial.area(geometry) };
  });
  const targets = boundsIndex(cells.map((value) => ({ bounds: value.bounds, value }))),
    sources = boundsIndex(pieces.map((value) => ({ bounds: spatial.bounds(value.source), value })));
  return (source: number) => {
    const cell = cells[source],
      amounts = new Map<number, number>();
    for (const piece of sources(cell.bounds)) {
      const part = spatial.intersection(cell.geometry, piece.source);
      if (!part || spatial.area(part) === 0) continue;
      accumulate(part, piece.forward, cell.area, targets, amounts);
    }
    return [...amounts].map(([target, fraction]) => ({ target, fraction }));
  };
}
function accumulate(
  source: Geometry,
  forward: MaterialAffine,
  sourceArea: number,
  targets: ReturnType<typeof boundsIndex<Cell>>,
  amounts: Map<number, number>
) {
  const box = spatial.bounds(source),
    corners = [
      [box[0], box[1]],
      [box[2], box[1]],
      [box[2], box[3]],
      [box[0], box[3]],
    ].map((p) => affinePoint(forward, [p[0], p[1]]));
  const imageBounds: Bounds = [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ];
  let assigned: Geometry | null = null;
  // Integrate in source space even for nonsingular motion: dividing a snapped
  // image area by an unsnapped Jacobian creates mass under strong compression.
  // A collapsed image can lie on a shared target face. Assign its source area
  // once, in coordinate order, rather than duplicating mass into both cells.
  for (const target of targets(imageBounds).sort(
    (a, b) => a.bounds[0] - b.bounds[0] || a.bounds[1] - b.bounds[1]
  )) {
    let part = sourceInsideCell(source, forward, target.geometry);
    if (part && assigned) part = spatial.difference(part, assigned);
    if (!part || spatial.area(part) === 0) continue;
    amounts.set(target.id, (amounts.get(target.id) ?? 0) + spatial.area(part) / sourceArea);
    assigned = assigned ? spatial.union(assigned, part) : part;
  }
}

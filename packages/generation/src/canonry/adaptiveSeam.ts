import {
  allocateNumerical,
  generateNumerical,
  visitAdaptiveFace,
  type NumericalAllocator,
} from "@atlas/domain";
import type { PhysicalMesh } from "./mesh";

function visitSeamFaces(
  mesh: PhysicalMesh,
  cell: number,
  visit: (target: number, length: number, dx: number, dy: number) => void
) {
  if (!mesh.topology) throw new Error("An adaptive seam requires its tree.");
  const [west, , east] = mesh.bounds,
    x = mesh.x[cell],
    half = mesh.cellWidth[cell] / 2;
  const sides: (-1 | 1)[] = [];
  if (Math.abs(x - half - west) < 1e-6) sides.push(-1);
  if (Math.abs(x + half - east) < 1e-6) sides.push(1);
  for (const side of sides)
    visitAdaptiveFace(
      mesh.topology,
      mesh.cellToLeaf[cell],
      0,
      side,
      (leaf, length) => {
        const target = mesh.leafToCell[leaf];
        visit(
          target,
          length,
          mesh.x[target] - x + side * (east - west),
          mesh.y[target] - mesh.y[cell]
        );
      },
      -side * (east - west)
    );
}
/** Traverse matching opposite tree faces instead of a quadratic all-edge join. */
export function joinAdaptiveSeam(mesh: PhysicalMesh, numerical?: NumericalAllocator) {
  const [west, south, east, north] = mesh.bounds,
    degree = generateNumerical(
      { type: "int32", length: mesh.count, lifetime: "run", name: "adaptive:seamDegree" },
      (i) => {
        let count = mesh.degree[i];
        visitSeamFaces(mesh, i, () => count++);
        return count;
      },
      numerical
    ),
    stride = degree.reduce((n, count) => Math.max(n, count), mesh.stride),
    vector = (type: "int32" | "float32" | "float64", name: string) =>
      allocateNumerical(
        { type, length: mesh.count * stride, lifetime: "run", name: `adaptive:seam:${name}` },
        numerical
      ),
    next = {
      neighbors: vector("int32", "neighbors").fill(-1),
      edgeX: vector("float32", "edgeX"),
      edgeY: vector("float32", "edgeY"),
      edgeLength: vector("float64", "edgeLength"),
      faceLength: vector("float64", "faceLength"),
      faceDistance: vector("float64", "faceDistance"),
    };
  for (let i = 0; i < mesh.count; i++) {
    for (const key of Object.keys(next) as (keyof typeof next)[])
      next[key].set(
        mesh[key].subarray(i * mesh.stride, i * mesh.stride + mesh.degree[i]),
        i * stride
      );
    let edge = mesh.degree[i];
    visitSeamFaces(mesh, i, (target, length, dx, dy) => {
      const at = i * stride + edge++,
        distance = Math.hypot(dx, dy);
      next.neighbors[at] = target;
      next.edgeLength[at] = distance;
      next.edgeX[at] = dx / distance;
      next.edgeY[at] = dy / distance;
      next.faceLength[at] = length;
      next.faceDistance[at] = Math.abs(dx);
    });
    mesh.boundary[i] = Number(
      Math.abs(mesh.y[i] - mesh.cellHeight[i] / 2 - south) < 1e-6 ||
        Math.abs(mesh.y[i] + mesh.cellHeight[i] / 2 - north) < 1e-6
    );
  }
  if (numerical) {
    numerical.release(mesh.degree);
    for (const key of Object.keys(next) as (keyof typeof next)[]) numerical.release(mesh[key]);
  }
  Object.assign(mesh, next, { degree, stride, periodic: { width: east - west, columns: 0 } });
}

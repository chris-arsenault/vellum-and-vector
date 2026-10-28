import type { AdaptiveTopology } from "../adaptiveTopology";

/** Cells are numbered block-major: a cell id is `(block << blockShift) | offset`. Blocks are
 * the unit of residency, storage chunks, iteration and tiling; cells close in space have
 * close ids. */
export const blockShift = 14;
export const blockCells = 1 << blockShift;
export const blockMask = blockCells - 1;
export const blockOf = (cell: number) => cell >>> blockShift;
export const blockCount = (cells: number) => (cells + blockMask) >>> blockShift;

/** Membership of a cell in the lattice's footprint. */
export const nodata = 0;
export const content = 1;
export const halo = 2;

export interface PeriodicFrame {
  width: number;
  columns: number;
  poles?: { rows: number; spacingY: number };
}

/** The spatial domain of a coverage: cell geometry, adjacency and blocking. Geometry and
 * adjacency are arithmetic on the triangular lattice and stored on adaptive ones; either
 * way they are resident and never go through a band store. */
export interface Lattice {
  readonly kind: "triangular" | "adaptive";
  /** Ids, including nodata slots inside blocks. */
  readonly count: number;
  readonly contentCount: number;
  readonly blockCount: number;
  /** Origin of the lattice frame in world coordinates; `x`/`y` are relative to it. */
  readonly origin: [number, number];
  /** Content bounds relative to the origin. */
  readonly bounds: [number, number, number, number];
  readonly spacing: number;
  readonly openBoundary: boolean;
  readonly periodic?: PeriodicFrame;
  readonly contentRadius: number;
  readonly workRadius: number;
  /** The adaptive tree, or null on the triangular lattice. */
  readonly topology: AdaptiveTopology | null;
  /** Largest degree; edge slots are `edge < degree(i)`. */
  readonly stride: number;
  /** Offset of the lattice frame from the origin (triangular); zero on adaptive lattices. */
  readonly latticeOffset: [number, number];
  /** Live (content or halo) cells in a block; 0 means the block is absent. */
  blockLive(block: number): number;
  membership(cell: number): number;
  /** Whether the triangle points down (triangular lattice); false on adaptive lattices. */
  inverted(cell: number): boolean;
  x(cell: number): number;
  y(cell: number): number;
  area(cell: number): number;
  contentArea(cell: number): number;
  cellWidth(cell: number): number;
  cellHeight(cell: number): number;
  boundary(cell: number): boolean;
  degree(cell: number): number;
  neighbor(cell: number, edge: number): number;
  edgeLength(cell: number, edge: number): number;
  edgeX(cell: number, edge: number): number;
  edgeY(cell: number, edge: number): number;
  faceLength(cell: number, edge: number): number;
  faceDistance(cell: number, edge: number): number;
  /** The cell whose centroid is nearest the point, or -1 outside the lattice. */
  cellAt(x: number, y: number): number;
  /** A stable integer identity of the cell's position, for seeded hashes. */
  identity(cell: number): number;
  cellToLeaf(cell: number): number;
  leafToCell(leaf: number): number;
  /** Short east/west displacement in a periodic chart. */
  deltaX(dx: number): number;
  /** Canonical easting inside a periodic chart. */
  pointX(x: number): number;
  /** Canonical point; closed poles reflect overflow in y. */
  point(x: number, y: number): [number, number];
}
/** The edge of `cell` that leads to `target`, or -1. */
export function edgeTo(lattice: Lattice, cell: number, target: number) {
  for (let edge = 0; edge < lattice.degree(cell); edge++)
    if (lattice.neighbor(cell, edge) === target) return edge;
  return -1;
}
/** Visit every live cell. */
export function forEachCell(lattice: Lattice, visit: (cell: number) => void) {
  for (let block = 0; block < lattice.blockCount; block++) {
    if (!lattice.blockLive(block)) continue;
    const start = block << blockShift,
      end = Math.min(lattice.count, start + blockCells);
    for (let cell = start; cell < end; cell++) if (lattice.membership(cell)) visit(cell);
  }
}
/** Visit every content cell. */
export function forEachContentCell(lattice: Lattice, visit: (cell: number) => void) {
  for (let block = 0; block < lattice.blockCount; block++) {
    if (!lattice.blockLive(block)) continue;
    const start = block << blockShift,
      end = Math.min(lattice.count, start + blockCells);
    for (let cell = start; cell < end; cell++)
      if (lattice.membership(cell) === content) visit(cell);
  }
}

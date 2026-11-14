/** Cells are numbered block-major: a cell id is `(block << blockShift) | offset`. Blocks are
 * the unit of residency, storage chunks, iteration and tiling; cells close in space have
 * close ids. */
export declare const blockShift = 14;
export declare const blockCells: number;
export declare const blockMask: number;
export declare const blockOf: (cell: number) => number;
export declare const blockCount: (cells: number) => number;
/** Membership of a cell in the lattice's footprint. */
export declare const nodata = 0;
export declare const content = 1;
export declare const halo = 2;
export interface PeriodicFrame {
  width: number;
  columns: number;
  poles?: {
    rows: number;
    spacingY: number;
  };
}
/** The spatial domain of a coverage: the triangular lattice every map, world or region, is
 * built on. Geometry and adjacency are arithmetic and resident; they never go through a
 * band store. */
export interface Lattice {
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
  /** World-coordinate aliases; independent of whether frame edges are neighbors. */
  readonly coordinateWidth?: number;
  readonly contentRadius: number;
  readonly workRadius: number;
  /** Largest degree; edge slots are `edge < degree(i)`. */
  readonly stride: number;
  /** Offset of the lattice frame from the origin. */
  readonly latticeOffset: [number, number];
  /** Live (content or halo) cells in a block; 0 means the block is absent. */
  blockLive(block: number): number;
  membership(cell: number): number;
  /** Whether the triangle points down. */
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
  /** The cell at a lattice address, or -1 off the lattice. */
  addressCell(u: number, v: number, inverted: boolean): number;
  /** The lattice address of a cell. */
  address(cell: number): [number, number, boolean];
  /** Short east/west displacement in a periodic chart. */
  deltaX(dx: number): number;
  /** Canonical easting inside a periodic chart. */
  pointX(x: number): number;
  /** Canonical point; closed poles reflect overflow in y. */
  point(x: number, y: number): [number, number];
}
/** The edge of `cell` that leads to `target`, or -1. */
export declare function edgeTo(lattice: Lattice, cell: number, target: number): number;
/** Visit every live cell. */
export declare function forEachCell(lattice: Lattice, visit: (cell: number) => void): void;
/** Visit every content cell. */
export declare function forEachContentCell(lattice: Lattice, visit: (cell: number) => void): void;

import { type Lattice, type PeriodicFrame } from "./lattice";
/** Area of one lattice triangle at unit spacing. */
export declare const triangleArea: number;
export interface TriangularFrame {
  /** Work frame (content plus halo), relative to the origin. */
  width: number;
  height: number;
  spacing: number;
  spacingY: number;
  offset: [number, number];
}
export interface TriangularLatticeInput {
  /** Content bounds in world coordinates. */
  bounds: [number, number, number, number];
  frame: TriangularFrame;
  /** Whether a content position (world coordinates) lies in the footprint. */
  covers: (x: number, y: number) => boolean;
  /** Total content area, shared equally by the content cells. */
  area: number;
  padding: number;
  periodic?: PeriodicFrame;
  coordinateWidth?: number;
  openBoundary: boolean;
  /** Overrides the rectangle-and-footprint membership of an in-frame site. */
  membership?: (cell: number, x: number, y: number) => number;
}
/**
 * The world's triangular lattice as a raster. A site is `(a, d, inverted)` with `a` the east
 * index (`u + v`), `d` the north index (`v - u`) and `a ≡ d (mod 2)`; its centroid is
 * `x = (1.5 a + 1 + inverted) spacing`, `y = (√3 / 2) d spacingY`. Rows are `d`, each row
 * holds `columns` sites of each orientation; a cell id is `((row · columns + k) · 2) +
 * inverted`. Adjacency and geometry are arithmetic on the id; the footprint is a mask.
 */
export declare class TriangularLattice implements Lattice {
  readonly count: number;
  readonly contentCount: number;
  readonly blockCount: number;
  readonly origin: [number, number];
  readonly bounds: [number, number, number, number];
  readonly spacing: number;
  readonly spacingY: number;
  readonly openBoundary: boolean;
  readonly periodic?: PeriodicFrame;
  private readonly chartWidth?;
  readonly contentRadius: number;
  readonly workRadius: number;
  readonly stride = 3;
  readonly offset: [number, number];
  readonly rows: number;
  readonly columns: number;
  private readonly dMin;
  /** First east index of each (inverted, row parity) window. */
  private readonly aStart;
  /** Sites of each (inverted, row parity) window; beyond it a slot is nodata. */
  private readonly aCount;
  private readonly mask;
  private readonly live;
  private readonly contentCellArea;
  private readonly haloCellArea;
  private readonly frameWidth;
  private readonly frameHeight;
  constructor(input: TriangularLatticeInput);
  private classify;
  /** East index of a cell. */
  private a;
  /** North index of a cell. */
  private d;
  /** The cell at a site, or -1 off the lattice. Periodic charts wrap the east index. */
  siteCell(a: number, d: number, inverted: number): number;
  /** Cell of a lattice address (u, v, inverted), or -1. */
  addressCell(u: number, v: number, inverted: boolean): number;
  address(cell: number): [number, number, boolean];
  get latticeOffset(): [number, number];
  blockLive(block: number): number;
  membership(cell: number): number;
  inverted(cell: number): boolean;
  private siteX;
  private siteY;
  x(cell: number): number;
  y(cell: number): number;
  area(cell: number): number;
  contentArea(cell: number): number;
  cellWidth(): number;
  cellHeight(): number;
  boundary(cell: number): boolean;
  degree(): number;
  /** The neighbour's site before any periodic wrap: `[a, d]`. */
  private step;
  neighbor(cell: number, edge: number): number;
  private delta;
  edgeLength(cell: number, edge: number): number;
  edgeX(cell: number, edge: number): number;
  edgeY(cell: number, edge: number): number;
  faceLength(cell: number, edge: number): number;
  faceDistance(cell: number, edge: number): number;
  identity(cell: number): number;
  deltaX(dx: number): number;
  get coordinateWidth(): number | undefined;
  pointX(x: number): number;
  point(x: number, y: number): [number, number];
  /** Cube rounding to the nearest site of one orientation, in lattice units. */
  private candidate;
  cellAt(x: number, y: number): number;
  /** The clipped work boundary can omit a nearest infinite-lattice site. */
  private boundaryCell;
}

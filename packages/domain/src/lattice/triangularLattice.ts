import {
  blockCount,
  blockShift as blockShiftBinding,
  content as contentBinding,
  halo as haloBinding,
  nodata as nodataBinding,
  type Lattice,
  type PeriodicFrame,
} from "./lattice";

// Module-local copies for per-cell paths: a module runner (Vitest) turns imported bindings
// into namespace getters.
const blockShift = blockShiftBinding,
  content = contentBinding,
  halo = haloBinding,
  nodata = nodataBinding;

const rootThree = Math.sqrt(3);
/** Area of one lattice triangle at unit spacing. */
export const triangleArea = (3 * rootThree) / 4;

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
  openBoundary: boolean;
  /** Overrides the rectangle-and-footprint membership of an in-frame site. */
  membership?: (cell: number, x: number, y: number) => number;
}
function sign(value: number) {
  const result = Math.sign(value) * Math.round(Math.abs(value));
  return result === 0 ? 0 : result;
}
const parityOf = (d: number) => d & 1;

/**
 * The world's triangular lattice as a raster. A site is `(a, d, inverted)` with `a` the east
 * index (`u + v`), `d` the north index (`v - u`) and `a ≡ d (mod 2)`; its centroid is
 * `x = (1.5 a + 1 + inverted) spacing`, `y = (√3 / 2) d spacingY`. Rows are `d`, each row
 * holds `columns` sites of each orientation; a cell id is `((row · columns + k) · 2) +
 * inverted`. Adjacency and geometry are arithmetic on the id; the footprint is a mask.
 */
export class TriangularLattice implements Lattice {
  readonly kind = "triangular" as const;
  readonly count: number;
  readonly contentCount: number;
  readonly blockCount: number;
  readonly origin: [number, number];
  readonly bounds: [number, number, number, number];
  readonly spacing: number;
  readonly spacingY: number;
  readonly openBoundary: boolean;
  readonly periodic?: PeriodicFrame;
  readonly contentRadius: number;
  readonly workRadius: number;
  readonly topology = null;
  readonly stride = 3;
  readonly offset: [number, number];
  readonly rows: number;
  readonly columns: number;
  private readonly dMin: number;
  /** First east index of each (inverted, row parity) window. */
  private readonly aStart: Int32Array;
  /** Sites of each (inverted, row parity) window; beyond it a slot is nodata. */
  private readonly aCount: Int32Array;
  private readonly mask: Uint8Array;
  private readonly live: Int32Array;
  private readonly contentCellArea: number;
  private readonly haloCellArea: number;
  private readonly frameWidth: number;
  private readonly frameHeight: number;
  constructor(input: TriangularLatticeInput) {
    const { frame, bounds } = input;
    this.spacing = frame.spacing;
    this.spacingY = frame.spacingY;
    this.offset = frame.offset;
    this.origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const width = bounds[2] - bounds[0],
      height = bounds[3] - bounds[1];
    this.bounds = [-width / 2, -height / 2, width / 2, height / 2];
    this.frameWidth = frame.width;
    this.frameHeight = frame.height;
    this.periodic = input.periodic;
    this.openBoundary = input.openBoundary;
    this.contentRadius = Math.sqrt(input.area / Math.PI);
    this.workRadius = Math.hypot(width / 2 + input.padding, height / 2 + input.padding);
    const scaleY = (rootThree * frame.spacingY) / 2;
    this.dMin = Math.ceil((-frame.height / 2 - frame.offset[1]) / scaleY);
    const dMax = Math.floor((frame.height / 2 - frame.offset[1]) / scaleY);
    this.rows = Math.max(0, dMax - this.dMin + 1);
    this.aStart = new Int32Array(4);
    this.aCount = new Int32Array(4);
    let columns = 0;
    for (let inverted = 0; inverted < 2; inverted++) {
      const shift = (inverted ? 2 : 1) * frame.spacing + frame.offset[0],
        low = Math.ceil((-frame.width / 2 - shift) / (1.5 * frame.spacing)),
        high = this.periodic
          ? low + 2 * this.periodic.columns - 1
          : Math.floor((frame.width / 2 - shift) / (1.5 * frame.spacing));
      for (let parity = 0; parity < 2; parity++) {
        const first = low + ((((low & 1) ^ parity) + 2) & 1),
          count = Math.max(0, Math.floor((high - first) / 2) + 1);
        this.aStart[inverted * 2 + parity] = first;
        this.aCount[inverted * 2 + parity] = count;
        columns = Math.max(columns, count);
      }
    }
    // Every row holds `columns` sites of each orientation; the frame's edge sites are halo.
    this.aCount.fill(columns);
    this.columns = columns;
    this.count = this.rows * columns * 2;
    this.blockCount = blockCount(this.count);
    this.haloCellArea = triangleArea * frame.spacing ** 2;
    this.mask = new Uint8Array(this.count);
    this.live = new Int32Array(this.blockCount);
    let contentCount = 0;
    for (let cell = 0; cell < this.count; cell++) {
      const kind = this.classify(cell, input, width, height);
      this.mask[cell] = kind;
      if (kind === content) contentCount++;
      if (kind !== nodata) this.live[cell >>> blockShift]++;
    }
    this.contentCount = contentCount;
    this.contentCellArea = contentCount ? input.area / contentCount : 0;
  }
  private classify(cell: number, input: TriangularLatticeInput, width: number, height: number) {
    const inverted = cell & 1,
      t = cell >>> 1,
      row = Math.floor(t / this.columns),
      k = t - row * this.columns,
      parity = parityOf(row + this.dMin);
    if (k >= this.aCount[inverted * 2 + parity]) return nodata;
    const x = this.x(cell),
      y = this.y(cell);
    if (Math.abs(y) > this.frameHeight / 2) return nodata;
    if (input.membership) return input.membership(cell, x, y);
    if (
      Math.abs(x) <= width / 2 &&
      Math.abs(y) <= height / 2 &&
      input.covers(x + this.origin[0], y + this.origin[1])
    )
      return content;
    return halo;
  }
  /** East index of a cell. */
  private a(cell: number) {
    const inverted = cell & 1,
      t = cell >>> 1,
      row = Math.floor(t / this.columns),
      k = t - row * this.columns;
    return this.aStart[inverted * 2 + parityOf(row + this.dMin)] + 2 * k;
  }
  /** North index of a cell. */
  private d(cell: number) {
    return Math.floor((cell >>> 1) / this.columns) + this.dMin;
  }
  /** The cell at a site, or -1 off the lattice. Periodic charts wrap the east index. */
  siteCell(a: number, d: number, inverted: number) {
    const row = d - this.dMin;
    if (row < 0 || row >= this.rows) return -1;
    const window = inverted * 2 + parityOf(d),
      count = this.aCount[window];
    let k = (a - this.aStart[window]) >> 1;
    if (this.periodic) k = ((k % count) + count) % count;
    else if (k < 0 || k >= count) return -1;
    const cell = ((row * this.columns + k) << 1) | inverted;
    return this.mask[cell] === nodata ? -1 : cell;
  }
  /** Cell of a lattice address (u, v, inverted), or -1. */
  addressCell(u: number, v: number, inverted: boolean) {
    if (!Number.isSafeInteger(u) || !Number.isSafeInteger(v)) return -1;
    return this.siteCell(u + v, v - u, Number(inverted));
  }
  address(cell: number): [number, number, boolean] {
    const a = this.a(cell),
      d = this.d(cell);
    return [(a - d) / 2, (a + d) / 2, (cell & 1) === 1];
  }
  get latticeOffset() {
    return this.offset;
  }
  blockLive(block: number) {
    return this.live[block];
  }
  membership(cell: number) {
    return this.mask[cell];
  }
  inverted(cell: number) {
    return (cell & 1) === 1;
  }
  private siteX(a: number, inverted: number) {
    return (1.5 * a + 1 + inverted) * this.spacing + this.offset[0];
  }
  private siteY(d: number) {
    return (rootThree * d * this.spacingY) / 2 + this.offset[1];
  }
  x(cell: number) {
    return this.siteX(this.a(cell), cell & 1);
  }
  y(cell: number) {
    return this.siteY(this.d(cell));
  }
  area(cell: number) {
    const kind = this.mask[cell];
    return kind === content ? this.contentCellArea : kind === halo ? this.haloCellArea : 0;
  }
  contentArea(cell: number) {
    return this.mask[cell] === content ? this.contentCellArea : 0;
  }
  cellWidth() {
    return Math.sqrt(triangleArea) * this.spacing;
  }
  cellHeight() {
    return Math.sqrt(triangleArea) * this.spacing;
  }
  boundary(cell: number) {
    if (this.periodic?.poles) return false;
    return this.neighbor(cell, 0) < 0 || this.neighbor(cell, 1) < 0 || this.neighbor(cell, 2) < 0;
  }
  degree() {
    return 3;
  }
  /** The neighbour's site before any periodic wrap: `[a, d]`. */
  private step(cell: number, edge: number): [number, number] {
    const a = this.a(cell),
      d = this.d(cell),
      direction = cell & 1 ? 1 : -1;
    if (edge === 1) return [a + direction, d - direction];
    if (edge === 2) return [a + direction, d + direction];
    return [a, d];
  }
  neighbor(cell: number, edge: number) {
    const [a, d] = this.step(cell, edge);
    return this.siteCell(a, d, (cell & 1) ^ 1);
  }
  private delta(cell: number, edge: number): [number, number] {
    const [a, d] = this.step(cell, edge),
      inverted = (cell & 1) ^ 1;
    return [this.siteX(a, inverted) - this.x(cell), this.siteY(d) - this.y(cell)];
  }
  edgeLength(cell: number, edge: number) {
    if (this.neighbor(cell, edge) < 0) return this.spacing;
    const [dx, dy] = this.delta(cell, edge);
    return Math.hypot(dx, dy);
  }
  edgeX(cell: number, edge: number) {
    if (this.neighbor(cell, edge) < 0) return 0;
    const [dx, dy] = this.delta(cell, edge);
    return dx / Math.hypot(dx, dy);
  }
  edgeY(cell: number, edge: number) {
    if (this.neighbor(cell, edge) < 0) return 0;
    const [dx, dy] = this.delta(cell, edge);
    return dy / Math.hypot(dx, dy);
  }
  faceLength(cell: number, edge: number) {
    if (this.neighbor(cell, edge) < 0) return this.periodic?.poles ? 0 : rootThree * this.spacing;
    return edge === 0
      ? rootThree * this.spacingY
      : Math.hypot(1.5 * this.spacing, (rootThree * this.spacingY) / 2);
  }
  faceDistance(cell: number, edge: number) {
    return this.edgeLength(cell, edge);
  }
  identity(cell: number) {
    const [u, v, inverted] = this.address(cell);
    return Math.imul(u, 73856093) ^ Math.imul(v, 19349663) ^ (inverted ? 83492791 : 0);
  }
  cellToLeaf(cell: number) {
    return cell;
  }
  leafToCell(leaf: number) {
    return leaf;
  }
  deltaX(dx: number) {
    const width = this.periodic?.width;
    return width ? dx - Math.round(dx / width) * width : dx;
  }
  pointX(x: number) {
    const width = this.periodic?.width;
    if (!width) return x;
    return ((((x + width / 2) % width) + width) % width) - width / 2;
  }
  point(x: number, y: number): [number, number] {
    if (this.periodic?.poles) {
      const height = this.bounds[3] - this.bounds[1];
      const band = Math.floor((y + height / 2) / height);
      const phase = (y + height / 2) / height - band;
      y = Math.abs(band % 2) ? height / 2 - phase * height : -height / 2 + phase * height;
    }
    return [this.pointX(x), y];
  }
  /** Cube rounding to the nearest site of one orientation, in lattice units. */
  private candidate(latticeX: number, latticeY: number, inverted: number) {
    const sum = (latticeX - (inverted ? 2 : 1)) / 1.5,
      difference = (2 * latticeY) / rootThree,
      u = (sum - difference) / 2,
      v = (sum + difference) / 2,
      w = -u - v;
    let a = sign(u),
      b = sign(v);
    const c = sign(w),
      du = Math.abs(a - u),
      dv = Math.abs(b - v),
      dw = Math.abs(c - w);
    if (du > dv && du > dw) a = -b - c;
    else if (dv > dw) b = -a - c;
    return this.addressCell(a, b, inverted === 1);
  }
  cellAt(x: number, y: number) {
    [x, y] = this.point(x, y);
    const latticeX = (x - this.offset[0]) / this.spacing,
      latticeY = (y - this.offset[1]) / this.spacingY;
    const a = this.candidate(latticeX, latticeY, 0),
      b = this.candidate(latticeX, latticeY, 1);
    if (a >= 0 && b >= 0)
      return this.deltaX(this.x(a) - x) ** 2 + (this.y(a) - y) ** 2 <=
        this.deltaX(this.x(b) - x) ** 2 + (this.y(b) - y) ** 2
        ? a
        : b;
    return this.boundaryCell(x, y, latticeX, latticeY);
  }
  /** The clipped work boundary can omit a nearest infinite-lattice site. */
  private boundaryCell(x: number, y: number, latticeX: number, latticeY: number) {
    let index = -1,
      best = Infinity;
    for (let inverted = 0; inverted < 2; inverted++) {
      const sum = (latticeX - (inverted ? 2 : 1)) / 1.5,
        difference = (2 * latticeY) / rootThree;
      const u = sign((sum - difference) * 0.5),
        v = sign((sum + difference) * 0.5);
      for (let du = -2; du <= 2; du++)
        for (let dv = -2; dv <= 2; dv++) {
          const candidate = this.addressCell(u + du, v + dv, inverted === 1);
          if (candidate < 0) continue;
          const distance = this.deltaX(this.x(candidate) - x) ** 2 + (this.y(candidate) - y) ** 2;
          if (distance < best) {
            best = distance;
            index = candidate;
          }
        }
    }
    return index;
  }
}

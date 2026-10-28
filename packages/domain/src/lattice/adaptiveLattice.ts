import type { Geometry } from "geojson";
import {
  adaptiveCell,
  adaptiveLeafAt,
  createAdaptiveTopology,
  type AdaptiveSampling,
  type AdaptiveTopology,
} from "../adaptiveTopology";
import { adaptiveMeasures } from "../adaptiveField";
import { visitAdaptiveFace } from "../adaptiveFaceQuery";
import { rectangle, type Bounds } from "../spatial";
import { blockCount, blockShift, content, halo, type Lattice, type PeriodicFrame } from "./lattice";

/** Quadtree leaves of a region, content first then halo, with stored padded adjacency.
 * Region lattices are region sized; their columns are resident typed arrays. */
export class AdaptiveLattice implements Lattice {
  readonly kind = "adaptive" as const;
  readonly count: number;
  readonly contentCount: number;
  readonly blockCount: number;
  readonly origin: [number, number];
  bounds: [number, number, number, number];
  readonly spacing: number;
  readonly openBoundary = true;
  periodic?: PeriodicFrame;
  readonly contentRadius: number;
  readonly workRadius: number;
  readonly topology: AdaptiveTopology;
  stride: number;
  private readonly leafOf: Int32Array;
  private readonly cellOf: Int32Array;
  private xs!: Float64Array;
  private ys!: Float64Array;
  private widths!: Float64Array;
  private heights!: Float64Array;
  private areas!: Float64Array;
  private contentAreas!: Float64Array;
  private edges!: Uint8Array;
  private degrees!: Int32Array;
  private neighbors!: Int32Array;
  private edgeXs!: Float32Array;
  private edgeYs!: Float32Array;
  private edgeLengths!: Float64Array;
  private faceLengths!: Float64Array;
  private faceDistances!: Float64Array;
  private readonly live: Int32Array;
  constructor(topology: AdaptiveTopology, footprint: Geometry) {
    this.topology = topology;
    const measures = adaptiveMeasures(topology, footprint),
      leaves = measures.length;
    this.count = leaves;
    this.blockCount = blockCount(leaves);
    this.leafOf = new Int32Array(leaves);
    this.cellOf = new Int32Array(leaves);
    let contentCount = 0;
    for (let leaf = 0; leaf < leaves; leaf++) if (measures[leaf] > 0) contentCount++;
    this.contentCount = contentCount;
    let inside = 0,
      outside = contentCount;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const cell = measures[leaf] > 0 ? inside++ : outside++;
      this.leafOf[cell] = leaf;
      this.cellOf[leaf] = cell;
    }
    const bounds = topology.bounds;
    this.origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    this.bounds = [
      bounds[0] - this.origin[0],
      bounds[1] - this.origin[1],
      bounds[2] - this.origin[0],
      bounds[3] - this.origin[1],
    ];
    this.workRadius = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2;
    const { totalArea, contentArea } = this.measureCells(measures);
    this.contentRadius = Math.sqrt(contentArea / Math.PI);
    this.spacing = Math.sqrt(totalArea / leaves);
    this.stride = this.connectCells();
    this.live = new Int32Array(this.blockCount);
    for (let cell = 0; cell < leaves; cell++) this.live[cell >>> blockShift]++;
  }
  private measureCells(measures: ArrayLike<number>) {
    const leaves = this.count,
      bounds = this.topology.bounds;
    this.xs = new Float64Array(leaves);
    this.ys = new Float64Array(leaves);
    this.widths = new Float64Array(leaves);
    this.heights = new Float64Array(leaves);
    this.areas = new Float64Array(leaves);
    this.contentAreas = new Float64Array(leaves);
    this.edges = new Uint8Array(leaves);
    let totalArea = 0,
      contentArea = 0;
    for (let cell = 0; cell < leaves; cell++) {
      const b = adaptiveCell(this.topology, this.leafOf[cell]);
      this.xs[cell] = (b[0] + b[2]) / 2 - this.origin[0];
      this.ys[cell] = (b[1] + b[3]) / 2 - this.origin[1];
      this.widths[cell] = b[2] - b[0];
      this.heights[cell] = b[3] - b[1];
      this.areas[cell] = (b[2] - b[0]) * (b[3] - b[1]);
      this.contentAreas[cell] = measures[this.leafOf[cell]];
      this.edges[cell] = Number(
        b[0] === bounds[0] || b[1] === bounds[1] || b[2] === bounds[2] || b[3] === bounds[3]
      );
      totalArea += this.areas[cell];
      contentArea += this.contentAreas[cell];
    }
    return { totalArea, contentArea };
  }
  /** Padded adjacency from the tree's leaf faces; returns the stride. */
  private connectCells() {
    const leaves = this.count,
      topology = this.topology;
    this.degrees = new Int32Array(leaves);
    for (let cell = 0; cell < leaves; cell++) {
      const leaf = this.leafOf[cell];
      this.degrees[cell] = topology.offsets[leaf + 1] - topology.offsets[leaf];
    }
    const stride = this.degrees.reduce((maximum, value) => Math.max(maximum, value), 0),
      slots = leaves * stride;
    this.neighbors = new Int32Array(slots).fill(-1);
    this.edgeXs = new Float32Array(slots);
    this.edgeYs = new Float32Array(slots);
    this.edgeLengths = new Float64Array(slots);
    this.faceLengths = new Float64Array(slots);
    this.faceDistances = new Float64Array(slots);
    for (let cell = 0; cell < leaves; cell++) {
      const leaf = this.leafOf[cell];
      for (let edge = 0; edge < this.degrees[cell]; edge++) {
        const source = topology.offsets[leaf] + edge,
          at = cell * stride + edge;
        this.neighbors[at] = this.cellOf[topology.neighbors[source]];
        this.edgeXs[at] = topology.directionX[source];
        this.edgeYs[at] = topology.directionY[source];
        this.edgeLengths[at] = topology.distances[source];
        this.faceLengths[at] = topology.faceLengths[source];
        this.faceDistances[at] =
          this.edgeLengths[at] *
          Math.abs(
            topology.directionX[source] * topology.normalX[source] +
              topology.directionY[source] * topology.normalY[source]
          );
      }
    }
    return stride;
  }
  /** Join matching faces across the east/west edge so the region wraps like its world. */
  joinSeam() {
    const [west, south, east, north] = this.bounds,
      degree = new Int32Array(this.count);
    for (let cell = 0; cell < this.count; cell++) {
      let count = this.degrees[cell];
      this.visitSeamFaces(cell, () => count++);
      degree[cell] = count;
    }
    const stride = degree.reduce((n, count) => Math.max(n, count), this.stride),
      slots = this.count * stride,
      next = {
        neighbors: new Int32Array(slots).fill(-1),
        edgeXs: new Float32Array(slots),
        edgeYs: new Float32Array(slots),
        edgeLengths: new Float64Array(slots),
        faceLengths: new Float64Array(slots),
        faceDistances: new Float64Array(slots),
      };
    for (let cell = 0; cell < this.count; cell++) {
      const from = cell * this.stride,
        to = cell * stride,
        width = this.degrees[cell];
      next.neighbors.set(this.neighbors.subarray(from, from + width), to);
      next.edgeXs.set(this.edgeXs.subarray(from, from + width), to);
      next.edgeYs.set(this.edgeYs.subarray(from, from + width), to);
      next.edgeLengths.set(this.edgeLengths.subarray(from, from + width), to);
      next.faceLengths.set(this.faceLengths.subarray(from, from + width), to);
      next.faceDistances.set(this.faceDistances.subarray(from, from + width), to);
      let edge = width;
      this.visitSeamFaces(cell, (target, length, dx, dy) => {
        const at = to + edge++,
          distance = Math.hypot(dx, dy);
        next.neighbors[at] = target;
        next.edgeLengths[at] = distance;
        next.edgeXs[at] = dx / distance;
        next.edgeYs[at] = dy / distance;
        next.faceLengths[at] = length;
        next.faceDistances[at] = Math.abs(dx);
      });
      this.edges[cell] = Number(
        Math.abs(this.ys[cell] - this.heights[cell] / 2 - south) < 1e-6 ||
          Math.abs(this.ys[cell] + this.heights[cell] / 2 - north) < 1e-6
      );
    }
    Object.assign(this, next);
    this.degrees.set(degree);
    this.stride = stride;
    this.periodic = { width: east - west, columns: 0 };
  }
  private visitSeamFaces(
    cell: number,
    visit: (target: number, length: number, dx: number, dy: number) => void
  ) {
    const [west, , east] = this.bounds,
      x = this.xs[cell],
      half = this.widths[cell] / 2;
    const sides: (-1 | 1)[] = [];
    if (Math.abs(x - half - west) < 1e-6) sides.push(-1);
    if (Math.abs(x + half - east) < 1e-6) sides.push(1);
    for (const side of sides)
      visitAdaptiveFace(
        this.topology,
        this.leafOf[cell],
        0,
        side,
        (leaf, length) => {
          const target = this.cellOf[leaf];
          visit(
            target,
            length,
            this.xs[target] - x + side * (east - west),
            this.ys[target] - this.ys[cell]
          );
        },
        -side * (east - west)
      );
  }
  blockLive(block: number) {
    return this.live[block];
  }
  membership(cell: number) {
    return cell < this.contentCount ? content : halo;
  }
  x(cell: number) {
    return this.xs[cell];
  }
  y(cell: number) {
    return this.ys[cell];
  }
  area(cell: number) {
    return this.areas[cell];
  }
  contentArea(cell: number) {
    return this.contentAreas[cell];
  }
  cellWidth(cell: number) {
    return this.widths[cell];
  }
  cellHeight(cell: number) {
    return this.heights[cell];
  }
  boundary(cell: number) {
    return this.edges[cell] === 1;
  }
  degree(cell: number) {
    return this.degrees[cell];
  }
  neighbor(cell: number, edge: number) {
    return this.neighbors[cell * this.stride + edge];
  }
  edgeLength(cell: number, edge: number) {
    return this.edgeLengths[cell * this.stride + edge];
  }
  edgeX(cell: number, edge: number) {
    return this.edgeXs[cell * this.stride + edge];
  }
  edgeY(cell: number, edge: number) {
    return this.edgeYs[cell * this.stride + edge];
  }
  faceLength(cell: number, edge: number) {
    return this.faceLengths[cell * this.stride + edge];
  }
  faceDistance(cell: number, edge: number) {
    return this.faceDistances[cell * this.stride + edge];
  }
  cellAt(x: number, y: number) {
    [x, y] = this.point(x, y);
    const leaf = adaptiveLeafAt(this.topology, x + this.origin[0], y + this.origin[1]);
    return leaf < 0 ? -1 : this.cellOf[leaf];
  }
  identity(cell: number) {
    const round = (value: number) => {
      const result = Math.sign(value) * Math.round(Math.abs(value));
      return result === 0 ? 0 : result;
    };
    return (
      Math.imul(round((this.xs[cell] + this.origin[0]) * 1000), 73856093) ^
      Math.imul(round((this.ys[cell] + this.origin[1]) * 1000), 19349663)
    );
  }
  cellToLeaf(cell: number) {
    return this.leafOf[cell];
  }
  leafToCell(leaf: number) {
    return this.cellOf[leaf];
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
    return [this.pointX(x), y];
  }
}
/** A region lattice over `bounds` plus `padding`, wrapped east/west when the world is. */
export function createAdaptiveWorldLattice(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  padding: number,
  footprint: Geometry = rectangle(bounds),
  wrapX = false
) {
  const work: Bounds = [
      bounds[0] - (wrapX ? 0 : padding),
      bounds[1] - padding,
      bounds[2] + (wrapX ? 0 : padding),
      bounds[3] + padding,
    ],
    lattice = new AdaptiveLattice(createAdaptiveTopology(work, sampling), footprint);
  if (wrapX) lattice.joinSeam();
  lattice.bounds = [
    bounds[0] - lattice.origin[0],
    bounds[1] - lattice.origin[1],
    bounds[2] - lattice.origin[0],
    bounds[3] - lattice.origin[1],
  ];
  return lattice;
}

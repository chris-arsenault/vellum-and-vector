import { requireThat } from "../errors";

/** Padded adjacency as the generation meshes store it: `neighbors[i*stride+edge]` for
 * `edge < degree[i]`, -1 for no neighbour. */
export interface PaddedAdjacency {
  count: number;
  stride: number;
  degree: ArrayLike<number>;
  neighbors: ArrayLike<number>;
}
/** The undirected faces of an adjacency as columns, with a slot per directed edge. Each face
 * is listed once with from < to. Named float columns hold per-face quantities. */
export class EdgeTable {
  readonly count: number;
  readonly from: Int32Array;
  readonly to: Int32Array;
  /** Face index for directed edge `i*stride+edge`, -1 where no face exists. */
  readonly slot: Int32Array;
  private readonly columns = new Map<string, Float64Array>();
  constructor(adjacency: PaddedAdjacency) {
    const { count, stride, degree, neighbors } = adjacency;
    let faces = 0;
    for (let i = 0; i < count; i++)
      for (let edge = 0; edge < degree[i]; edge++) if (neighbors[i * stride + edge] > i) faces++;
    this.count = faces;
    this.from = new Int32Array(faces);
    this.to = new Int32Array(faces);
    this.slot = new Int32Array(count * stride).fill(-1);
    let index = 0;
    for (let i = 0; i < count; i++)
      for (let edge = 0; edge < degree[i]; edge++) {
        const at = i * stride + edge,
          j = neighbors[at];
        if (j <= i) continue;
        this.slot[at] = index;
        this.slot[j * stride + edgeLeadingTo(adjacency, j, i)] = index;
        this.from[index] = i;
        this.to[index] = j;
        index++;
      }
  }
  /** A float column per face, created on first use. */
  column(name: string): Float64Array {
    let values = this.columns.get(name);
    if (!values) {
      values = new Float64Array(this.count);
      this.columns.set(name, values);
    }
    return values;
  }
  /** The other end of face `f` seen from `cell`. */
  other(f: number, cell: number) {
    return this.from[f] === cell ? this.to[f] : this.from[f];
  }
}
export function edgeLeadingTo(adjacency: PaddedAdjacency, i: number, target: number) {
  const base = i * adjacency.stride;
  for (let edge = 0; edge < adjacency.degree[i]; edge++)
    if (adjacency.neighbors[base + edge] === target) return edge;
  requireThat(false, "edge_missing", "Adjacency is not symmetric.");
  return -1;
}

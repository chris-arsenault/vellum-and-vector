export type ContourPoint = [number, number];
export interface ContourEdge {
  id: number;
  a: ContourPoint;
  b: ContourPoint;
}
/** Temporary directed contour graph. Coordinates have already been rounded to world precision. */
export interface ContourEdges {
  add(a: ContourPoint, b: ContourPoint): void;
  first(): ContourEdge | undefined;
  outgoing(point: ContourPoint): ContourEdge[];
  consume(id: number): void;
  close(): void;
}
export interface ContourWorkspace {
  open(): ContourEdges;
}

/** In-memory execution for domain callers; browser generation supplies local working storage. */
export class MemoryContourEdges implements ContourEdges {
  private sequence = 0;
  private edges = new Map<number, ContourEdge>();
  private starts = new Map<string, Map<number, ContourEdge>>();
  add(a: ContourPoint, b: ContourPoint) {
    const edge = { id: ++this.sequence, a, b },
      key = a.join(":");
    this.edges.set(edge.id, edge);
    let outgoing = this.starts.get(key);
    if (!outgoing) this.starts.set(key, (outgoing = new Map()));
    outgoing.set(edge.id, edge);
  }
  first() {
    return this.edges.values().next().value;
  }
  outgoing(point: ContourPoint) {
    return [...(this.starts.get(point.join(":"))?.values() ?? [])];
  }
  consume(id: number) {
    const edge = this.edges.get(id)!;
    const key = edge.a.join(":"),
      outgoing = this.starts.get(key)!;
    outgoing.delete(id);
    if (!outgoing.size) this.starts.delete(key);
    this.edges.delete(id);
  }
  close() {
    this.edges.clear();
    this.starts.clear();
  }
}

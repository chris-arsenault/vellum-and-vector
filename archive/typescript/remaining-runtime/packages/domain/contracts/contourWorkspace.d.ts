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
export declare class MemoryContourEdges implements ContourEdges {
  private sequence;
  private edges;
  private starts;
  add(a: ContourPoint, b: ContourPoint): void;
  first(): ContourEdge | undefined;
  outgoing(point: ContourPoint): ContourEdge[];
  consume(id: number): void;
  close(): void;
}

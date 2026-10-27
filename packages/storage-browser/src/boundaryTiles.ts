import type { Geometry } from "geojson";
import { rectangle, translateGeometry, type Bounds, type WorkspaceScope } from "@atlas/domain";
import { ByteCache } from "./byteCache";
import { BoundaryIndex } from "./boundaryIndex";
import {
  boundarySegments,
  edgeKey,
  pointKey,
  segmentBounds,
  segmentLine,
  type BoundarySegment,
} from "./boundarySegments";
import type { GeometryKernel } from "./geometryKernel";

export const regionTopologyTileMetres = 250_000;
export const regionTopologyCacheBytes = 16 * 1024 * 1024;
export const regionQueryTileCacheBytes = 4 * 1024 * 1024;
interface Tile {
  scope: WorkspaceScope;
  bounds: Bounds;
  edges: BoundarySegment[];
  nodes: Map<string, BoundarySegment[]>;
}
function overlaps(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
function makeTile(
  scope: WorkspaceScope,
  bounds: Bounds,
  edges: BoundarySegment[],
  precision: number
): Tile {
  const nodes = new Map<string, BoundarySegment[]>();
  for (const s of edges) {
    const a = pointKey(s.ax, s.ay, precision),
      b = pointKey(s.bx, s.by, precision);
    if (!nodes.has(a)) nodes.set(a, []);
    if (!nodes.has(b)) nodes.set(b, []);
    nodes.get(a)!.push(s);
    nodes.get(b)!.push({ ax: s.bx, ay: s.by, bx: s.ax, by: s.ay });
  }
  return { scope, bounds, edges, nodes };
}
export class BoundaryTiles {
  private cache = new ByteCache<string, Tile>(regionTopologyCacheBytes);
  constructor(
    readonly index: BoundaryIndex,
    readonly kernel: GeometryKernel,
    readonly size = regionTopologyTileMetres
  ) {}
  invalidate(scope: Pick<WorkspaceScope, "worldId" | "spaceId">, bounds: Bounds) {
    this.cache.deleteWhere(
      (_, tile) =>
        tile.scope.worldId === scope.worldId &&
        tile.scope.spaceId === scope.spaceId &&
        overlaps(tile.bounds, bounds)
    );
  }
  private base(scope: WorkspaceScope, column: number, row: number, precision: number): Tile {
    const key = JSON.stringify([
      scope.worldId,
      scope.spaceId,
      scope.areaId,
      column,
      row,
      precision,
    ]);
    const previous = this.cache.get(key);
    if (previous) return previous;
    const x = column * this.size,
      y = row * this.size;
    const bounds: Bounds = [x, y, x + this.size, y + this.size];
    const edges = this.node(this.index.segments(scope, bounds), bounds, precision);
    const tile = makeTile(scope, bounds, edges, precision);
    this.cache.set(key, tile, edges.length * 512 + 128);
    return tile;
  }
  node(edges: BoundarySegment[], bounds: Bounds, precision: number) {
    if (!edges.length) return [];
    // Local coordinates keep overlay arithmetic near the tile's scale at large world offsets.
    const source: Geometry = { type: "MultiLineString", coordinates: edges.map(segmentLine) };
    const shifted = translateGeometry(source, -bounds[0]);
    const moveY = (g: Geometry): Geometry => {
      if (g.type !== "MultiLineString") throw new Error("Expected boundary linework.");
      return {
        type: "MultiLineString",
        coordinates: g.coordinates.map((line) => line.map(([x, y]) => [x, y - bounds[1]])),
      };
    };
    const result = this.kernel.nodeLines(
      moveY(shifted),
      rectangle([0, 0, bounds[2] - bounds[0], bounds[3] - bounds[1]]),
      precision
    );
    if (!result) return [];
    return [...boundarySegments(result)].map((s) => ({
      ax: Math.round((s.ax + bounds[0]) / precision) * precision,
      ay: Math.round((s.ay + bounds[1]) / precision) * precision,
      bx: Math.round((s.bx + bounds[0]) / precision) * precision,
      by: Math.round((s.by + bounds[1]) / precision) * precision,
    }));
  }
  graph(scope: WorkspaceScope, extra: Geometry[], precision: number) {
    const dynamic = extra.flatMap((geometry) => [...boundarySegments(geometry)]);
    const tiles = new ByteCache<string, Tile>(regionQueryTileCacheBytes);
    const tileAt = (column: number, row: number) => {
      const key = `${column},${row}`;
      let tile = tiles.get(key);
      if (tile) return tile;
      const base = this.base(scope, column, row, precision);
      const add = dynamic.filter((s) => overlaps(segmentBounds(s), base.bounds));
      tile = add.length
        ? makeTile(
            scope,
            base.bounds,
            // Clipping can leave an isolated endpoint on a tile border. Keep the original
            // linework when adding cuts/borders so that endpoint nodes adjacent linework.
            this.node([...this.index.segments(scope, base.bounds), ...add], base.bounds, precision),
            precision
          )
        : base;
      tiles.set(key, tile, tile.edges.length * 512 + 128);
      return tile;
    };
    const indices = (value: number) => {
      const at = Math.floor(value / this.size);
      return Math.abs(value - at * this.size) <= precision ? [at - 1, at] : [at];
    };
    return {
      at: (x: number, y: number) => {
        const edges = new Map<string, BoundarySegment>();
        for (const column of indices(x))
          for (const row of indices(y))
            for (const s of tileAt(column, row).edges) edges.set(edgeKey(s, precision), s);
        return [...edges.values()];
      },
      outgoing: (x: number, y: number) => {
        const target = pointKey(x, y, precision),
          edges = new Map<string, BoundarySegment>();
        for (const column of indices(x))
          for (const row of indices(y))
            for (const s of tileAt(column, row).nodes.get(target) ?? [])
              edges.set(edgeKey(s, precision), s);
        return [...edges.values()];
      },
      dynamic,
    };
  }
}
export type BoundaryGraph = ReturnType<BoundaryTiles["graph"]>;

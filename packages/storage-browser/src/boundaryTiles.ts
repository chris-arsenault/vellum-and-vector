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
/** Installs boundary sources for an extent before it is read. Returns the area's bounds and
 * the bounds of sources whose linework changed. */
export type PrepareBoundaries = (
  scope: WorkspaceScope,
  extent: Bounds
) => { area: Bounds; changed: Bounds[] };
/** Tile cells whose sources are installed for one scope at one world revision. */
interface Prepared {
  revision: number;
  area: Bounds | null;
  cells: Set<string>;
}
function overlaps(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
function clip(extent: Bounds, area: Bounds): Bounds | null {
  const covered: Bounds = [
    Math.max(area[0], extent[0]),
    Math.max(area[1], extent[1]),
    Math.min(area[2], extent[2]),
    Math.min(area[3], extent[3]),
  ];
  return covered[0] > covered[2] || covered[1] > covered[3] ? null : covered;
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
/** Noded tiles over the boundary index. Preparation is explicit and bounded to the tiles a
 * query visits; this is the only place that asks the projection to install sources. */
export class BoundaryTiles {
  private cache = new ByteCache<string, Tile>(regionTopologyCacheBytes);
  private prepared = new Map<string, Prepared>();
  constructor(
    readonly index: BoundaryIndex,
    readonly kernel: GeometryKernel,
    private prepare: PrepareBoundaries,
    private revision: (worldId: string) => number,
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
  /**
   * Prepare an extent, dropping cached tiles whose sources changed. Sources are installed once
   * per tile cell and world revision: the cells an extent adds are prepared in one call, and
   * an extent of prepared cells installs nothing.
   */
  private ensure(scope: WorkspaceScope, extent: Bounds) {
    const key = JSON.stringify([scope.worldId, scope.spaceId, scope.areaId]),
      revision = this.revision(scope.worldId);
    let state = this.prepared.get(key);
    if (state?.revision !== revision)
      this.prepared.set(key, (state = { revision, area: null, cells: new Set() }));
    const size = this.size,
      missing: string[] = [];
    // Cells are closed, so an extent ending on a cell edge lies in the lower cell.
    const cells = (low: number, high: number) => [
      Math.floor(low / size),
      Math.max(Math.floor(low / size), Math.ceil(high / size) - 1),
    ];
    const [firstColumn, lastColumn] = cells(extent[0], extent[2]),
      [firstRow, lastRow] = cells(extent[1], extent[3]);
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
    for (let column = firstColumn; column <= lastColumn; column++)
      for (let row = firstRow; row <= lastRow; row++) {
        const cell = `${column},${row}`;
        if (state.cells.has(cell)) continue;
        missing.push(cell);
        west = Math.min(west, column * size);
        south = Math.min(south, row * size);
        east = Math.max(east, (column + 1) * size);
        north = Math.max(north, (row + 1) * size);
      }
    if (missing.length) {
      const prepared = this.prepare(scope, [west, south, east, north]);
      for (const bounds of prepared.changed) this.invalidate(scope, bounds);
      state.area = prepared.area;
      for (const cell of missing) state.cells.add(cell);
    }
    return clip(extent, state.area!);
  }
  segments(scope: WorkspaceScope, extent: Bounds) {
    this.ensure(scope, extent);
    return this.index.segments(scope, extent);
  }
  *inside(scope: WorkspaceScope, extent: Bounds) {
    this.ensure(scope, extent);
    yield* this.index.inside(scope, extent);
  }
  /** Expand the eastward search window locally until a crossing appears or the area ends. */
  nearest(scope: WorkspaceScope, x: number, y: number): BoundarySegment | null {
    for (let width = this.size; ; width *= 2) {
      const covered = this.ensure(scope, [x, y, x + width, y]);
      if (!covered) return null;
      const east = Math.min(x + width, covered[2]);
      const hit = this.index.nearest(scope, x, y, east);
      if (hit) return hit;
      if (covered[2] < x + width) return null;
    }
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
    const edges = this.node(this.segments(scope, bounds), bounds, precision);
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

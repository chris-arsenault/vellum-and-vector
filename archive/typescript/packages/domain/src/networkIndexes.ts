import type { Crossing, NetworkNode, Position } from "./model";
import type { DomainSnapshot } from "./operations";
import { Spatial, point, type Bounds, type SpatialIndex } from "./spatial";

export type Near = (
  snapshot: DomainSnapshot,
  p: Position
) => { nodes: NetworkNode[]; crossings: Crossing[] };
/** Node and boundary-crossing lookups for one topology update, answered by native indexes. */
export class TopologySpatial<Path extends object> extends Spatial {
  /** Noded endpoints per path list and (space, layer), shared by every path of that network. */
  readonly anchors = new WeakMap<Path[], Map<string, Position[]>>();
  constructor(
    precision: number,
    readonly near: Near
  ) {
    super(precision);
  }
}
/** Existing nodes and boundary crossings within precision of a point, per snapshot world. */
export function withNetworkIndexes<T>(
  precision: number,
  snapshots: DomainSnapshot[],
  work: (near: Near) => T
): T {
  const gis = new Spatial(precision),
    worlds = [...new Set(snapshots.map((s) => s.world))],
    sources = worlds.map((world) => ({
      nodes: Object.values(world.networkNodes ?? {}),
      crossings: Object.values(world.areas).flatMap((a) => a.boundary?.crossings ?? []),
    }));
  const indexes: SpatialIndex[] = [];
  const near: Near = (snapshot, p) => {
    const at = worlds.indexOf(snapshot.world),
      window: Bounds = [p.x - precision, p.y - precision, p.x + precision, p.y + precision];
    return {
      nodes: indexes[at * 2].query(window).map((i) => sources[at].nodes[i]),
      crossings: indexes[at * 2 + 1].query(window).map((i) => sources[at].crossings[i]),
    };
  };
  const lists = sources.flatMap((s) => [
    s.nodes.map((n) => point(n.position)),
    s.crossings.map((c) => point(c.point)),
  ]);
  const open = (i: number): T =>
    i === lists.length
      ? work(near)
      : gis.withIndex(lists[i], (index) => {
          indexes[i] = index;
          return open(i + 1);
        });
  return open(0);
}

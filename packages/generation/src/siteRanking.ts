import {
  fieldChartFootprint,
  gridPosition,
  gridDisplacement,
  neighbors,
  settlementSiteKinds,
  spatial,
  MapScale,
  type FieldChannelName,
  type SettlementSiteKind,
} from "@atlas/domain";
import { harbourGoodDepth, harbourSurge, uninhabitableIce } from "./poi/settlements/workFacts";
import type { GenerationState } from "./process";

/**
 * Settlement sites obey geology. A refined map's villages are proposed where its developed
 * ground offers a site, taken in a fixed order of reliability: a pass, the ground beside a
 * Fire core, a river node, a harbour, a melt line, a fishery coast, a halo edge, a node on
 * the plain. Open plain is no site, so villages scatter and towns do not.
 */
export interface SiteOpportunity {
  kind: SettlementSiteKind;
  score: number;
  reason: string;
}
const rank = (kind: SettlementSiteKind) => settlementSiteKinds.indexOf(kind);
const unit = (value: number) => Math.max(0, Math.min(1, value));
/** Ground of the surface that is neither sea nor lake. */
function dryLand(state: Pick<GenerationState, "surface">, i: number) {
  const { active, channels: c } = state.surface;
  if (i < 0 || i >= active.length) return false;
  return Boolean(
    active.get(i) &&
    (c.WaterKindCodes
      ? c.WaterKindCodes.get(i) === 0
      : (c.Elevation?.get(i) ?? 0) > (c.EffectiveSeaLevel?.get(i) ?? 0))
  );
}

class SiteReader {
  readonly grid;
  readonly scale;
  private readonly covers;
  private lastRing: { cell: number; neighbors: number[] } | undefined;
  constructor(readonly state: Pick<GenerationState, "surface">) {
    this.grid = state.surface;
    this.scale = MapScale.fromCells(this.grid.bounds, this.grid.active.length);
    this.covers = spatial.geometryCoverage(fieldChartFootprint(this.grid));
  }
  value(name: FieldChannelName, i: number, fallback = 0) {
    return this.grid.channels[name]?.get(i) ?? fallback;
  }
  /** Eight neighbours in angular order, so a saddle shows as alternating high and low. */
  ring(i: number) {
    if (this.lastRing?.cell === i) return this.lastRing.neighbors;
    const p = gridPosition(this.grid, i);
    const ring = neighbors(this.grid, i, true, this.covers).sort((a, b) => {
      const qa = gridPosition(this.grid, a),
        qb = gridPosition(this.grid, b);
      const da = gridDisplacement(this.grid, p, qa),
        db = gridDisplacement(this.grid, p, qb);
      return Math.atan2(da.y, da.x) - Math.atan2(db.y, db.x);
    });
    this.lastRing = { cell: i, neighbors: ring };
    return ring;
  }
  /** The four edge neighbours: a junction counts channels that actually enter the cell. */
  cross(i: number) {
    return neighbors(this.grid, i, false, this.covers);
  }
  ocean(i: number) {
    return this.value("WaterKindCodes", i) === 1;
  }
  lake(i: number) {
    return this.value("WaterKindCodes", i) === 2;
  }
  river(i: number) {
    return this.value("RiverOrders", i) >= 1;
  }
  elevation(i: number) {
    return this.value("Elevation", i);
  }
  /** Ice thickness is measured in metres in the working field and resources. */
  ice(i: number) {
    return this.value("IceThickness", i);
  }
  /** A class holds a site where its coverage passes a tenth; membership stands in where none is published. */
  feature(system: string, rule: string, i: number) {
    const coverage = this.grid.channels[`magic:${system}:coverage:${rule}`];
    if (coverage) return coverage.get(i) >= 0.1;
    return this.value(`magic:${system}:feature:${rule}`, i) > 0;
  }
}

/** A col: the ring alternates high and low at least twice, with real relief both ways. */
function pass(r: SiteReader, i: number): SiteOpportunity | null {
  const ring = r.ring(i);
  if (ring.length < 6) return null;
  const own = r.elevation(i);
  let changes = 0,
    highest = -Infinity,
    lowest = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const here = r.elevation(ring[k]) > own,
      next = r.elevation(ring[(k + 1) % ring.length]) > own;
    if (here !== next) changes++;
    highest = Math.max(highest, r.elevation(ring[k]));
    lowest = Math.min(lowest, r.elevation(ring[k]));
  }
  const rise = highest - own,
    drop = own - lowest;
  if (
    changes < 4 ||
    rise < MapScale.inUnits(r.scale.length(0.0000375), "native") ||
    drop < MapScale.inUnits(r.scale.length(0.0000375), "native")
  )
    return null;
  return {
    kind: "pass",
    score: unit(Math.min(rise, drop) / MapScale.inUnits(r.scale.length(0.00015), "native")),
    reason: `a col ${Math.round(MapScale.metres(rise, "native"))} m below the heights and ${Math.round(MapScale.metres(drop, "native"))} m above the lowlands on both sides`,
  };
}
/** The last habitable ground beside a Fire core: the seat of a large settlement. */
function fireSeat(r: SiteReader, i: number): SiteOpportunity | null {
  if (r.feature("fire", "core", i) || !r.ring(i).some((j) => r.feature("fire", "core", j)))
    return null;
  return { kind: "fire-seat", score: 1 - r.value("Quickening", i), reason: "beside a Fire core" };
}
function riverNode(r: SiteReader, i: number): SiteOpportunity | null {
  if (!r.river(i)) return null;
  const ring = r.ring(i),
    riverNeighbours = r.cross(i).filter((j) => r.river(j)).length;
  const junction = riverNeighbours >= 3,
    mouth =
      r.value("Slope", i) < 0.004 && ring.some((j) => r.river(j) && r.value("Slope", j) > 0.012);
  if (!junction && !mouth) return null;
  return {
    kind: "river-node",
    score:
      unit(Math.log1p(r.value("FlowAccumulation", i) / r.scale.volume(1.5625e-20)) / 8) +
      (junction ? 0.3 : 0),
    reason: junction ? "a river junction" : "where the river leaves the hills for the plain",
  };
}
/** How a stretch of sea serves a harbour: shelter, lee, depth, surge, and the storm season. */
function harbourWaters(r: SiteReader, sea: number[]) {
  const peak = (channel: FieldChannelName) => Math.max(...sea.map((j) => r.value(channel, j)));
  const shelter = sea.length <= 3 ? 1 : sea.length <= 4 ? 0.6 : 0.2,
    lee = 1 - sea.reduce((s, j) => s + r.value("WaveExposure", j), 0) / (1000 * sea.length),
    depth =
      peak("WaterDepths") >= MapScale.inUnits(r.scale.resolveMeasure(harbourGoodDepth), "native")
        ? 1
        : 0.4,
    surge = peak("magic:pressure:intensity") >= harbourSurge ? 0.3 : 1,
    // A harbour on a storm track is closed for the season the storms run.
    seasonal = peak("StormTrack") >= 300;
  return { score: shelter * lee * depth * surge * (seasonal ? 0.6 : 1), seasonal };
}
function harbour(r: SiteReader, i: number): SiteOpportunity | null {
  const sea = r.ring(i).filter((j) => r.ocean(j));
  if (!sea.length) return null;
  const waters = harbourWaters(r, sea),
    estuary = r.river(i),
    score = waters.score * (estuary ? 1.3 : 1);
  if (score < 0.35) return null;
  const where = sea.length <= 3 ? "a sheltered bay" : "a coast",
    mouth = estuary ? " at a river mouth" : "",
    closed = waters.seasonal ? ", closed in the storm season" : "";
  return {
    kind: "harbour",
    score,
    reason: `${where}${mouth} with deep water near the shore${closed}`,
  };
}
function meltLine(r: SiteReader, i: number): SiteOpportunity | null {
  return r.feature("aurora", "melt", i)
    ? {
        kind: "melt-line",
        score: 1,
        reason: "on an Aurora melt line, the one rich strip of the field",
      }
    : null;
}
function fisheryCoast(r: SiteReader, i: number): SiteOpportunity | null {
  const sea = r.ring(i).filter((j) => r.ocean(j));
  if (!sea.length) return null;
  const upwelling = Math.max(...sea.map((j) => r.value("Upwelling", j)));
  return upwelling >= 300
    ? { kind: "fishery-coast", score: upwelling / 1000, reason: "facing an upwelling fishery" }
    : null;
}
function haloEdge(r: SiteReader, i: number): SiteOpportunity | null {
  const q = r.value("Quickening", i);
  return q >= 0.08 && q <= 0.5
    ? { kind: "halo-edge", score: 1 - Math.abs(q - 0.3) * 2, reason: "at the edge of a Fire halo" }
    : null;
}
function plainNode(r: SiteReader, i: number): SiteOpportunity | null {
  const ring = r.ring(i);
  const options: [number, string][] = [];
  if (r.feature("fire", "spring", i)) options.push([0.7, "at a hot spring"]);
  if (ring.some((j) => r.lake(j))) options.push([0.6, "on a lake shore"]);
  if (r.river(i)) options.push([0.5, "at a river crossing"]);
  if (ring.some((j) => r.value("WetlandCover", j) >= 0.3)) options.push([0.4, "at a marsh edge"]);
  if (!options.length) return null;
  const [score, reason] = options.sort((a, b) => b[0] - a[0])[0];
  return { kind: "plain-node", score, reason };
}
/** Ground nobody settles: ice, the heart of a core, the inside of an Aurora field. */
function uninhabitable(r: SiteReader, i: number) {
  return (
    r.ice(i) > r.scale.resolveMeasure(uninhabitableIce) ||
    r.value("Quickening", i) >= 0.6 ||
    r.value("Stillness", i) >= 0.6 ||
    r.feature("fire", "core", i)
  );
}
/** A Greenwood spring: water that heals and fertilises, and a town that must not overdraw it. */
function healingWell(r: SiteReader, i: number): SiteOpportunity | null {
  return r.feature("greenwood", "wellspring", i) || r.feature("greenwood", "oasis", i)
    ? { kind: "healing-well", score: 0.9, reason: "at a Greenwood spring" }
    : null;
}
/** A Veil door: the house and its keepers, and a crossing that makes an inland town a port. */
function doorHouse(r: SiteReader, i: number): SiteOpportunity | null {
  return r.feature("veil", "door", i)
    ? { kind: "door-house", score: 0.85, reason: "at a Veil door, the house of a crossing" }
    : null;
}
/** Inside a Hallowed ring: the ground on which nothing is harmed, and the pilgrims who come to it. */
function sanctuary(r: SiteReader, i: number): SiteOpportunity | null {
  return r.feature("hallowed", "ring", i)
    ? { kind: "sanctuary", score: 0.8, reason: "inside a Hallowed ring, where nothing is harmed" }
    : null;
}
/** A killing ground: the memorial garden a Salt tradition rakes, and the court beside the graves. */
function necropolis(r: SiteReader, i: number): SiteOpportunity | null {
  return r.feature("salt", "ground", i)
    ? { kind: "necropolis", score: 0.6, reason: "on a killing ground, the memorial garden" }
    : null;
}
const classifiers = [
  pass,
  fireSeat,
  riverNode,
  harbour,
  doorHouse,
  sanctuary,
  meltLine,
  healingWell,
  necropolis,
  fisheryCoast,
  haloEdge,
  plainNode,
];
/** The best site class each land cell offers, or null where nothing better than plain exists. */
export function rankSites(state: Pick<GenerationState, "surface">): (SiteOpportunity | null)[] {
  const r = new SiteReader(state),
    count = state.surface.active.length;
  return Array.from({ length: count }, (_, i) => siteAt(r, i));
}
function siteAt(r: SiteReader, i: number) {
  if (!dryLand(r.state, i) || uninhabitable(r, i)) return null;
  let best: SiteOpportunity | null = null;
  for (const classify of classifiers) {
    const site = classify(r, i);
    if (site && (!best || rank(site.kind) < rank(best.kind))) best = site;
  }
  return best;
}

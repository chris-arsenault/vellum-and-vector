import {
  gridPosition,
  gridDisplacement,
  neighbors,
  settlementSiteKinds,
  spatial,
  type Band,
  type SettlementSiteKind,
  type SocietyCommunity,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { dryLand, supportAt } from "./societySupport";

/**
 * Settlement sites obey geology. The population unit is the catchment the spacing draw
 * made; the site is the one place inside it that the geography offers, taken in a fixed
 * order of reliability: a pass, the ground beside a Fire core, a river node, a harbour,
 * a melt line, a fishery coast, a halo edge, a node on the plain. Open plain is no site:
 * a catchment with nothing better keeps its draw, so villages scatter and towns do not.
 */
export type SettlementSite = NonNullable<SocietyCommunity["site"]>;
export interface SiteOpportunity {
  kind: SettlementSiteKind;
  score: number;
  reason: string;
}
const rank = (kind: SettlementSiteKind) => settlementSiteKinds.indexOf(kind);
const unit = (value: number) => Math.max(0, Math.min(1, value));

class SiteReader {
  readonly grid;
  private readonly covers;
  private lastRing: { cell: number; neighbors: number[] } | undefined;
  constructor(readonly state: Pick<GenerationState, "surface">) {
    this.grid = state.surface;
    this.covers = spatial.geometryCoverage(this.grid.scope.footprint);
  }
  value(name: string, i: number, fallback = 0) {
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
    return this.value("water", i) === 1;
  }
  lake(i: number) {
    return this.value("water", i) === 2;
  }
  river(i: number) {
    return this.value("riverOrder", i) >= 1;
  }
  elevation(i: number) {
    return this.value("elevation", i);
  }
  /** Ice in metres, from whichever ice channel the surface carries. */
  ice(i: number) {
    return this.grid.channels.iceThickness
      ? this.value("iceThickness", i)
      : this.value("ice", i) * 1000;
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
  if (changes < 4 || rise < 150 || drop < 150) return null;
  return {
    kind: "pass",
    score: unit(Math.min(rise, drop) / 600),
    reason: `a col ${Math.round(rise)} m below the heights and ${Math.round(drop)} m above the lowlands on both sides`,
  };
}
/** The last habitable ground beside a Fire core: the seat of a large settlement. */
function fireSeat(r: SiteReader, i: number): SiteOpportunity | null {
  if (r.feature("fire", "core", i) || !r.ring(i).some((j) => r.feature("fire", "core", j)))
    return null;
  return { kind: "fire-seat", score: 1 - r.value("quickening", i), reason: "beside a Fire core" };
}
function riverNode(r: SiteReader, i: number): SiteOpportunity | null {
  if (!r.river(i)) return null;
  const ring = r.ring(i),
    riverNeighbours = r.cross(i).filter((j) => r.river(j)).length;
  const junction = riverNeighbours >= 3,
    mouth =
      r.value("slope", i) < 0.004 && ring.some((j) => r.river(j) && r.value("slope", j) > 0.012);
  if (!junction && !mouth) return null;
  return {
    kind: "river-node",
    score: unit(Math.log1p(r.value("flow", i)) / 8) + (junction ? 0.3 : 0),
    reason: junction ? "a river junction" : "where the river leaves the hills for the plain",
  };
}
/** How a stretch of sea serves a harbour: shelter, lee, depth, surge, and the storm season. */
function harbourWaters(r: SiteReader, sea: number[]) {
  const peak = (channel: string) => Math.max(...sea.map((j) => r.value(channel, j)));
  const shelter = sea.length <= 3 ? 1 : sea.length <= 4 ? 0.6 : 0.2,
    // Wave exposure is published as a 0..1 ratio of the native 0..1000.
    lee = 1 - sea.reduce((s, j) => s + r.value("waveExposure", j), 0) / sea.length,
    depth = peak("waterDepth") >= 10 ? 1 : 0.4,
    surge = peak("magic:pressure:intensity") >= 400 ? 0.3 : 1,
    // A harbour on a storm track is closed for the season the storms run.
    seasonal = peak("stormTrack") >= 0.3;
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
  // Upwelling is published as a 0..1 ratio; 0.3 is the native 300 a front lifts.
  const upwelling = Math.max(...sea.map((j) => r.value("upwelling", j)));
  return upwelling >= 0.3
    ? { kind: "fishery-coast", score: upwelling, reason: "facing an upwelling fishery" }
    : null;
}
function haloEdge(r: SiteReader, i: number): SiteOpportunity | null {
  const q = r.value("quickening", i);
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
  if (ring.some((j) => r.value("wetlandCover", j) >= 0.3)) options.push([0.4, "at a marsh edge"]);
  if (!options.length) return null;
  const [score, reason] = options.sort((a, b) => b[0] - a[0])[0];
  return { kind: "plain-node", score, reason };
}
/** Ground nobody settles: ice, the heart of a core, the inside of an Aurora field. */
function uninhabitable(r: SiteReader, i: number) {
  return (
    r.ice(i) > 1 ||
    r.value("quickening", i) >= 0.6 ||
    r.value("stillness", i) >= 0.6 ||
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
/**
 * A mobile band camps where food and warmth are: halo edges, melt lines, fishery coasts and
 * river crossings. A pass or a harbour means nothing to it, and it never seats a core.
 */
const mobileClassifiers = [haloEdge, meltLine, fisheryCoast, riverNode, plainNode];
export interface SiteOptions {
  mobile: boolean;
  /** Ruins of earlier rounds by cell: a site there is preferred within its class. */
  ruins: Map<number, string>;
}
const settled: SiteOptions = { mobile: false, ruins: new Map() };
/** The best site class each land cell offers, or null where nothing better than plain exists. */
export function rankSites(
  state: Pick<GenerationState, "surface">,
  options: SiteOptions = settled
): (SiteOpportunity | null)[] {
  const r = new SiteReader(state),
    count = state.surface.active.length;
  return Array.from({ length: count }, (_, i) => siteAt(r, i, options));
}
function siteAt(r: SiteReader, i: number, options: SiteOptions) {
  if (!dryLand(r.state, i) || uninhabitable(r, i)) return null;
  const kinds = options.mobile ? mobileClassifiers : classifiers;
  return onRuins(bestClass(r, i, kinds), options.ruins.get(i));
}
function bestClass(r: SiteReader, i: number, kinds: typeof classifiers) {
  let best: SiteOpportunity | null = null;
  for (const classify of kinds) {
    const site = classify(r, i);
    if (site && (!best || rank(site.kind) < rank(best.kind))) best = site;
  }
  return best;
}
/** A camp of an earlier round makes a site more attractive within its class, never a class. */
function onRuins(site: SiteOpportunity | null, ruin: string | undefined) {
  if (!site || !ruin) return site;
  return { ...site, score: site.score + 0.3, reason: `${site.reason}, on the ruins of ${ruin}` };
}
/**
 * A fortress needs three things at once: a route to control (a pass, or a gorge beside a
 * river node), a defensible spur that is still reachable, and a reason to hold it, which
 * is a hazard in the country below. Scarcity comes from the conjunction, not a quota.
 */
function fortress(r: SiteReader, site: number, kind: SettlementSiteKind) {
  const ring = r.ring(site);
  const route =
    kind === "pass" ||
    (kind === "river-node" && [site, ...ring].some((j) => r.value("landform", j) === 16));
  if (!route) return null;
  const hazard = ring.some((j) => r.value("quickening", j) >= 0.15)
    ? "a volatile Fire halo below"
    : ring.some((j) => r.ocean(j) && r.value("magic:pressure:intensity", j) >= 300)
      ? "Pressure surge on the coast below"
      : null;
  if (!hazard) return null;
  const own = r.elevation(site);
  const spur = ring.find((j) => {
    const above = r.elevation(j) - own,
      slope = r.value("slope", j);
    return (
      dryLand(r.state, j) &&
      above >= 100 &&
      above <= 500 &&
      slope >= 0.008 &&
      slope <= 0.05 &&
      r.value("landform", j) !== 6
    );
  });
  return spur === undefined ? null : { cell: spur, reason: hazard };
}
/**
 * Each unit takes its best-ranked site class; within the class the highest opportunity
 * times capacity wins, and the random draw only breaks ties. A unit with nothing but
 * plain keeps the cell its draw gave it.
 */
export function chooseSettlementSites(
  state: GenerationState,
  context: MapProcessContext,
  owner: Band,
  seeds: number[],
  river: Band,
  coast: Band,
  options: SiteOptions = settled
): { cell: number; site: SettlementSite | null }[] {
  const r = new SiteReader(state);
  const best = seeds.map((seed) => ({
    cell: seed,
    site: null as SettlementSite | null,
    key: [Infinity, 0],
  }));
  const ties = state.surface.coverage
    .scratch("float64", "society-site-ties", owner.length)
    .fill(NaN);
  const draw = (i: number) => {
    if (Number.isNaN(ties.get(i))) ties.set(i, context.random());
    return ties.get(i);
  };
  for (let i = 0; i < owner.length; i++) {
    const k = owner.get(i),
      site = siteAt(r, i, options);
    if (k < 0 || k >= best.length || !site) continue;
    const capacity = supportAt(state, i, river.get(i), coast.get(i)).capacity,
      key = [rank(site.kind), -site.score * (1 + capacity)];
    const current = best[k];
    if (!betterSite(key, current.key, () => draw(i) > draw(current.cell))) continue;
    current.cell = i;
    current.key = key;
    current.site = { kind: site.kind, reason: site.reason, fortress: false };
  }
  state.surface.coverage.release(ties);
  // A band on the move holds no fortress and camps on the col itself.
  if (options.mobile) return best;
  return distinctSeats(
    r,
    best,
    best.map((choice, k) => passFoot(r, holdFromSpur(r, choice), owner, k, seeds[k]))
  );
}
/**
 * A spur or pass-foot move must not put two seats on one cell, since a seat's cell is its
 * identity, nor on ground no one can live on; a move that would is undone.
 */
function distinctSeats(
  r: SiteReader,
  before: { cell: number; site: SettlementSite | null }[],
  after: { cell: number; site: SettlementSite | null }[]
) {
  const taken = new Set(before.map((choice) => choice.cell));
  return after.map((choice, k) => {
    if (choice.cell === before[k].cell) return choice;
    const occupied =
      taken.has(choice.cell) || after.some((o, j) => j !== k && o.cell === choice.cell);
    if (occupied || uninhabitable(r, choice.cell)) return before[k];
    taken.add(choice.cell);
    return choice;
  });
}
/**
 * A pass town sits at the foot of the pass, on the last flat ground below the col and on
 * the side its people came from. A fortress stays on its spur.
 */
function passFoot(
  r: SiteReader,
  choice: { cell: number; site: SettlementSite | null },
  owner: Band,
  unit: number,
  seed: number
) {
  if (choice.site?.kind !== "pass" || choice.site.fortress) return choice;
  const col = r.elevation(choice.cell),
    origin = gridPosition(r.grid, seed);
  const foot = r
    .ring(choice.cell)
    .filter((j) => dryLand(r.state, j) && col - r.elevation(j) >= 50)
    .sort((a, b) => {
      const ownA = Number(owner.get(a) === unit),
        ownB = Number(owner.get(b) === unit);
      if (ownA !== ownB) return ownB - ownA;
      const slopeA = r.value("slope", a),
        slopeB = r.value("slope", b);
      if (slopeA !== slopeB) return slopeA - slopeB;
      const pa = gridPosition(r.grid, a),
        pb = gridPosition(r.grid, b);
      return (
        Math.hypot(pa.x - origin.x, pa.y - origin.y) - Math.hypot(pb.x - origin.x, pb.y - origin.y)
      );
    })[0];
  if (foot === undefined) return choice;
  return {
    cell: foot,
    site: { ...choice.site, reason: `at the foot of the pass: ${choice.site.reason}` },
  };
}
/** Lower rank wins; then higher weighted opportunity; the draw decides only an exact tie. */
function betterSite(key: number[], current: number[], tie: () => boolean) {
  if (key[0] !== current[0]) return key[0] < current[0];
  if (key[1] !== current[1]) return key[1] < current[1];
  return tie();
}
function holdFromSpur(
  r: SiteReader,
  choice: { cell: number; site: SettlementSite | null }
): { cell: number; site: SettlementSite | null } {
  const spur = choice.site && fortress(r, choice.cell, choice.site.kind);
  if (!spur || !choice.site) return { cell: choice.cell, site: choice.site };
  return {
    cell: spur.cell,
    site: {
      ...choice.site,
      fortress: true,
      reason: `${choice.site.reason}; held from a spur above because of ${spur.reason}`,
    },
  };
}

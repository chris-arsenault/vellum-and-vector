import type { Band } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { units } from "../world/math";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { deposit, erode, raiseFromCrust, weatherRock } from "../rock/groundLedger";
import type { FlowCause, Pool } from "./flows";

/** Who is wearing the land, and which history band remembers it. */
export interface WearCause {
  readonly id: FlowCause;
  readonly remembers: PhysicalBufferName;
  /** Whether it can cut below sea level, as ice and waves do, where water cannot. */
  readonly pastBaseLevel?: boolean;
}
/** What a cell's ground holds of each pool, which is all a demand on it can get. */
const onTheGround = new Set<Pool>(["soil", "loose", "rock"]);
interface Demand {
  cause: FlowCause;
  from: Pool;
  to: Pool;
  amount: Band;
  /** For wear: what the history remembers, which for a channel is its depth and not the lowering. */
  recorded?: Band;
  wear?: WearCause;
}
/** How much each demand on a cell was granted, as a share of what it asked. */
type Grant = (demand: Demand, i: number) => number;
/** How the ledger lands a demand that takes nothing off the ground's top. */
function landing({ from, to }: Demand) {
  if (from === "rock" && to === "loose") return weatherRock;
  if (from === "crust" && to === "rock") return raiseFromCrust;
  return (map: PhysicalField, i: number, amount: number, cause: FlowCause) =>
    deposit(map, i, amount, cause, from);
}

/**
 * One stage of change. Processes demand transfers of material between pools on cells, and nothing
 * moves until the stage settles, so every process in it works from the ground as it stood. Settling
 * lands every demand through the ledger. In a sequential stage the demands land in the order they were
 * made, each taking what is left. In a simultaneous stage processes compete: where they ask a pool for
 * more than a cell holds, each gets its share of what is there, and what a cause lays down is what it
 * got. Nothing wears below base level, however much is asked for, except what can cut beneath the sea.
 */
export class Stage {
  private readonly demands = new Map<string, Demand>();
  constructor(
    private readonly map: PhysicalField,
    private readonly options: { readonly simultaneous: boolean }
  ) {}
  get simultaneous() {
    return this.options.simultaneous;
  }
  private demandOf(cause: FlowCause, from: Pool, to: Pool, wear?: WearCause) {
    const key = `${cause}|${from}|${to}`;
    let demand = this.demands.get(key);
    if (!demand) {
      demand = {
        cause,
        from,
        to,
        amount: workingArray(this.map, "float64", `stage:${key}`).fill(0),
        wear,
      };
      if (wear) demand.recorded = workingArray(this.map, "float64", `stage:r:${key}`).fill(0);
      this.demands.set(key, demand);
    }
    return demand;
  }
  /** A cause asks to move `amount` of height on a cell from one pool to another. */
  demand(from: Pool, to: Pool, cell: number, amount: number, cause: FlowCause) {
    if (amount > 0) this.demandOf(cause, from, to).amount.add(cell, amount);
  }
  /**
   * A cause asks to lower a cell by `lowering`, taking loose cover first and then rock, and to have
   * `recorded` remembered for it.
   */
  wear(cause: WearCause, cell: number, lowering: number, recorded = lowering) {
    if (lowering <= 0) return;
    const loose = Math.min(lowering, Math.max(0, this.map.SedimentThickness.get(cell))),
      share = recorded / lowering;
    if (loose > 0) this.wearFrom("loose", cause, cell, loose, share);
    if (lowering > loose) this.wearFrom("rock", cause, cell, lowering - loose, share);
  }
  private wearFrom(from: Pool, cause: WearCause, cell: number, amount: number, share: number) {
    const demand = this.demandOf(cause.id, from, "load", cause);
    demand.amount.add(cell, amount);
    demand.recorded!.add(cell, amount * share);
  }
  /** What a pool on this cell can give: what lies there, and of rock what stands above base level. */
  private supply(from: Pool, i: number, pastBaseLevel: boolean) {
    const map = this.map;
    if (from === "soil") return units(map.SoilDepth.get(i));
    if (from === "loose") return Math.max(0, map.SedimentThickness.get(i));
    if (from !== "rock" || pastBaseLevel || map.WaterKindCodes.get(i) === 1) return Infinity;
    return Math.max(0, map.Elevation.get(i) - (map.EffectiveSeaLevel + units(1)));
  }
  private takes() {
    return [...this.demands.values()].filter(
      (one) => onTheGround.has(one.from) && !(one.from === "rock" && one.to === "loose")
    );
  }
  /** Everyone's demands land, and the stage is over. What each cause moved off the ground, by cause. */
  settle(): Map<FlowCause, number> {
    const takes = this.takes(),
      grant = this.options.simultaneous ? this.shared(takes) : this.inTurn(takes),
      moved = new Map<FlowCause, number>(),
      asked = new Map<FlowCause, number>();
    for (const demand of takes) this.landTakes(demand, grant, moved, asked);
    for (const demand of this.demands.values())
      if (!takes.includes(demand)) this.landRest(demand, moved, asked);
    for (const { amount, recorded } of this.demands.values())
      releaseWorking(this.map, amount, ...(recorded ? [recorded] : []));
    this.demands.clear();
    return moved;
  }
  /** Each pool on a cell shared among all who ask it, by what they ask. */
  private shared(takes: Demand[]): Grant {
    const shares = new Map<Demand, Float64Array>();
    for (let i = 0; i < this.map.mesh.count; i++)
      for (const from of onTheGround) {
        const asking = takes.filter((one) => one.from === from && one.amount.get(i) > 0);
        if (!asking.length) continue;
        const total = asking.reduce((sum, one) => sum + one.amount.get(i), 0);
        for (const one of asking) {
          const share = Math.min(1, this.supply(from, i, one.wear?.pastBaseLevel ?? false) / total);
          this.shareOf(shares, one)[i] = share;
        }
      }
    return (demand, i) => shares.get(demand)?.[i] ?? 0;
  }
  /** Each demand takes what is left of its pool after those made before it. */
  private inTurn(takes: Demand[]): Grant {
    const shares = new Map<Demand, Float64Array>();
    for (let i = 0; i < this.map.mesh.count; i++) {
      const left = new Map<Pool, number>();
      for (const one of takes) {
        const wanted = one.amount.get(i);
        if (wanted <= 0) continue;
        const has = left.get(one.from) ?? this.poolLeft(takes, one, i),
          got = Math.min(wanted, has);
        left.set(one.from, has - got);
        this.shareOf(shares, one)[i] = got / wanted;
      }
    }
    return (demand, i) => shares.get(demand)?.[i] ?? 0;
  }
  /** Rock's base level is shared by everything wearing a cell, as one asking; loose is taken in turn. */
  private poolLeft(takes: Demand[], first: Demand, i: number) {
    const supply = this.supply(first.from, i, first.wear?.pastBaseLevel ?? false);
    if (first.from !== "rock" || !Number.isFinite(supply)) return supply;
    const total = takes
      .filter((one) => one.from === "rock" && !one.wear?.pastBaseLevel)
      .reduce((sum, one) => sum + one.amount.get(i), 0);
    return total > supply ? supply : Infinity;
  }
  private shareOf(shares: Map<Demand, Float64Array>, demand: Demand) {
    let held = shares.get(demand);
    if (!held) shares.set(demand, (held = new Float64Array(this.map.mesh.count)));
    return held;
  }
  private landTakes(
    demand: Demand,
    grant: Grant,
    moved: Map<FlowCause, number>,
    asked: Map<FlowCause, number>
  ) {
    const map = this.map;
    let got = 0,
      wanted = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      const amount = demand.amount.get(i);
      if (amount <= 0) continue;
      const share = grant(demand, i),
        taken = Math.round(amount * share);
      wanted += amount;
      if (taken <= 0) continue;
      got += erode(map, i, taken, demand.cause, demand.to);
      if (demand.wear) this.remember(demand, i, taken, share);
    }
    moved.set(demand.cause, (moved.get(demand.cause) ?? 0) + got);
    asked.set(demand.cause, (asked.get(demand.cause) ?? 0) + wanted);
  }
  /** Worn ground feeds the sediment on the move, and the history remembers the wear. */
  private remember(demand: Demand, i: number, taken: number, share: number) {
    const map = this.map;
    map.SedimentSupply.add(i, taken);
    map.SedimentProducedTotal += (taken / 1024) * map.mesh.area(i);
    map[demand.wear!.remembers].add(i, demand.recorded!.get(i) * share);
  }
  /** What is laid down, made from rock in place, or raised from the crust. */
  private landRest(demand: Demand, moved: Map<FlowCause, number>, asked: Map<FlowCause, number>) {
    const map = this.map,
      wanted = asked.get(demand.cause) ?? 0,
      ratio = this.simultaneous && wanted > 0 ? (moved.get(demand.cause) ?? 0) / wanted : 1;
    const land = landing(demand);
    for (let i = 0; i < map.mesh.count; i++) {
      const amount = Math.round(demand.amount.get(i) * ratio);
      if (amount > 0) land(map, i, amount, demand.cause);
    }
  }
}

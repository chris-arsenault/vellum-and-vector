import type { Band } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { units } from "../world/math";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { wearAway } from "../rock/groundLedger";
import type { FlowCause } from "./flows";

/** Who is wearing the land, and which history band remembers it. */
export interface WearCause {
  readonly id: FlowCause;
  readonly remembers: PhysicalBufferName;
  /** Whether it can cut below sea level, as ice and waves do, where water cannot. */
  readonly pastBaseLevel?: boolean;
}
interface Demand {
  cause: WearCause;
  /** How far it would lower the cell's mean height. */
  lowering: Band;
  /** What the history records, which for a channel is its depth and not the mean lowering. */
  recorded: Band;
}
/**
 * One stage of wear. A process states what it would take from each cell and nothing changes yet, so
 * every cell it works on is the ground as it stood. Settling then lands it: nothing wears below base
 * level, however much is asked for. Each process settles when it finishes, so processes act in the
 * sequence's order; causes demanding in one stage would share what can go.
 */
export class WearStage {
  private readonly demands = new Map<FlowCause, Demand>();
  constructor(private readonly map: PhysicalField) {}
  private demandOf(cause: WearCause) {
    let demand = this.demands.get(cause.id);
    if (!demand) {
      demand = {
        cause,
        lowering: workingArray(this.map, "float64", `wear:lowering:${cause.id}`).fill(0),
        recorded: workingArray(this.map, "float64", `wear:recorded:${cause.id}`).fill(0),
      };
      this.demands.set(cause.id, demand);
    }
    return demand;
  }
  /** A cause asks to lower a cell by `lowering`, and to have `recorded` remembered for it. */
  demand(cause: WearCause, cell: number, lowering: number, recorded = lowering) {
    if (lowering <= 0) return;
    const demand = this.demandOf(cause);
    demand.lowering.add(cell, lowering);
    demand.recorded.add(cell, recorded);
  }
  /** How much of what was asked of a cell can go: all of it, or what stands above base level. */
  private shareThatCanGo(cell: number, asked: number) {
    const map = this.map;
    if (map.WaterKindCodes.get(cell) === 1) return 1;
    const above = map.Elevation.get(cell) - (map.EffectiveSeaLevel + units(1));
    return above >= asked ? 1 : Math.max(0, above) / asked;
  }
  /** Everyone's demands land together, and the stage is over. */
  settle() {
    const map = this.map,
      all = [...this.demands.values()];
    for (let i = 0; i < map.mesh.count; i++) {
      let asked = 0;
      for (const demand of all) asked += demand.lowering.get(i);
      if (asked <= 0) continue;
      const share = this.shareThatCanGo(i, asked);
      for (const { cause, lowering, recorded } of all) {
        const amount = lowering.get(i);
        if (amount <= 0) continue;
        const allowed = cause.pastBaseLevel ? 1 : share;
        wearAway(map, i, Math.round(amount * allowed), cause.id);
        map[cause.remembers].add(i, recorded.get(i) * allowed);
      }
    }
    for (const { lowering, recorded } of all) releaseWorking(map, lowering, recorded);
    this.demands.clear();
  }
}

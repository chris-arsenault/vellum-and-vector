import { RecordQueue, type Band } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { deposit, raiseFromCrust, weatherRock } from "../rock/groundLedger";
import type { FlowCause, Pool } from "./flows";
import { settleRemovals, type GroundSource, type RemovalRequest } from "./stageRemoval";

/** Who is wearing the land, and which history band remembers it. */
export interface WearCause {
  readonly id: FlowCause;
  readonly remembers: PhysicalBufferName;
  readonly pastBaseLevel?: boolean;
}
interface Removal extends RemovalRequest {
  recorded?: Band;
  wear?: WearCause;
  /** Source cell, destination cell and requested volume; destinations retain their actual source. */
  routes?: RecordQueue;
}
interface Landing {
  from: Pool;
  to: Pool;
  cause: FlowCause;
  amount: Band;
}
const landings = new Set(["load:loose", "sea:loose", "rock:loose", "crust:rock"]);
function land(map: PhysicalField, request: Landing, i: number, amount: number) {
  if (request.from === "rock") return weatherRock(map, i, amount, request.cause);
  if (request.from === "crust") return raiseFromCrust(map, i, amount, request.cause);
  return deposit(map, i, amount, request.cause, request.from);
}

/**
 * Commands land only on settlement. Surface wear strips cover then rock; explicit loose removal
 * cannot cut rock. Soil is a skin of those substrates, not another independent supply pool.
 * Routed moves retain source and destination, so competition affects only that source's outflow.
 * All commands decide against the starting field. Sequential stages grant each pool in submission
 * order; actBy runs separate stages when a process must see its predecessor's landed changes.
 */
export class Stage {
  private readonly removals = new Map<string, Removal>();
  private readonly landings = new Map<string, Landing>();
  constructor(
    private readonly map: PhysicalField,
    private readonly options: { readonly simultaneous: boolean }
  ) {}
  get simultaneous() {
    return this.options.simultaneous;
  }
  private removal(from: GroundSource, cause: FlowCause, wear?: WearCause, routed = false) {
    const pastBaseLevel = Boolean(wear?.pastBaseLevel),
      key = `${cause}|${from}|${pastBaseLevel}|${wear?.remembers ?? ""}|${routed}`;
    let request = this.removals.get(key);
    if (!request) {
      request = {
        from,
        cause,
        wear,
        pastBaseLevel,
        amount: workingArray(this.map, "float64", `stage:${key}`).fill(0),
        routes: routed ? new RecordQueue(2) : undefined,
      };
      if (wear) request.recorded = workingArray(this.map, "float64", `stage:record:${key}`).fill(0);
      this.removals.set(key, request);
    }
    return request;
  }
  /** Local transformations or standalone withdrawals. Transport between cells uses moveLoose/moveSurface. */
  demand(from: Pool, to: Pool, cell: number, amount: number, cause: FlowCause) {
    if (to === "load" && (from === "loose" || from === "rock")) {
      if (amount > 0) this.removal(from, cause).amount.add(cell, amount);
      return;
    }
    if (!landings.has(`${from}:${to}`))
      throw new Error(`Unsupported stage transfer: ${from} -> ${to}`);
    if (amount <= 0) return;
    const key = `${cause}|${from}|${to}`;
    let request = this.landings.get(key);
    if (!request) {
      request = {
        from,
        to,
        cause,
        amount: workingArray(this.map, "float64", `stage:${key}`).fill(0),
      };
      this.landings.set(key, request);
    }
    request.amount.add(cell, amount);
  }
  /** Surface lowering and its separately measured history, resolved after all demands arrive. */
  wear(cause: WearCause, cell: number, lowering: number, recorded = lowering) {
    if (lowering <= 0) return;
    const request = this.removal("surface", cause.id, cause);
    request.amount.add(cell, lowering);
    request.recorded!.add(cell, recorded);
  }
  /** Carries loose cover only; each destination receives what its own source was granted. */
  moveLoose(source: number, target: number, volume: number, cause: FlowCause) {
    this.route("loose", source, target, volume, cause);
  }
  /** Slope failure carries the surface's cover and then rock, rather than pretending it is all rock. */
  moveSurface(source: number, target: number, volume: number, cause: FlowCause) {
    this.route("surface", source, target, volume, cause);
  }
  private route(
    from: GroundSource,
    source: number,
    target: number,
    volume: number,
    cause: FlowCause
  ) {
    if (volume <= 0) return;
    const request = this.removal(from, cause, undefined, true);
    request.amount.add(source, (volume * 1024) / this.map.mesh.area(source));
    request.routes!.push(source, target, volume);
  }
  /** Land withdrawals first, then their routed deposits and independent local transformations. */
  settle(): Map<FlowCause, number> {
    const requests = [...this.removals.values()],
      landed = settleRemovals(this.map, requests, this.simultaneous),
      moved = new Map<FlowCause, number>();
    for (const request of requests) {
      const actual = landed.get(request)!;
      this.remember(request, actual, moved);
      this.landRoutes(request, actual);
      releaseWorking(
        this.map,
        request.amount,
        actual,
        ...(request.recorded ? [request.recorded] : [])
      );
    }
    for (const request of this.landings.values()) {
      for (let i = 0; i < this.map.mesh.count; i++) {
        const amount = Math.round(request.amount.get(i));
        if (amount > 0) land(this.map, request, i, amount);
      }
      releaseWorking(this.map, request.amount);
    }
    this.removals.clear();
    this.landings.clear();
    return moved;
  }
  private remember(request: Removal, actual: Band, moved: Map<FlowCause, number>) {
    let sum = 0;
    for (let i = 0; i < this.map.mesh.count; i++) {
      const taken = actual.get(i);
      sum += taken;
      if (taken <= 0) continue;
      // Routed material lands here; un-routed withdrawals feed the later carrier process.
      if (!request.routes) this.map.SedimentSupply.add(i, taken);
      this.map.SedimentProducedTotal += (taken / 1024) * this.map.mesh.area(i);
      if (!request.wear) continue;
      this.map[request.wear.remembers].add(
        i,
        (request.recorded!.get(i) * taken) / request.amount.get(i)
      );
    }
    moved.set(request.cause, (moved.get(request.cause) ?? 0) + sum);
  }
  private landRoutes(request: Removal, actual: Band) {
    const routes = request.routes;
    if (!routes) return;
    while (routes.size) {
      const source = routes.shift(),
        target = routes.field(0),
        volume = routes.field(1),
        granted = actual.get(source) / request.amount.get(source);
      deposit(
        this.map,
        target,
        (volume * granted * 1024) / this.map.mesh.area(target),
        request.cause
      );
    }
  }
}

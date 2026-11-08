import { RecordQueue, type Band } from "@atlas/domain";
import type { MutablePhysicalBufferName, PhysicalField } from "../world/field";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { deposit, raiseFromCrust, weatherRock, weatherRockBy } from "../rock/groundLedger";
import { facetShare, type GroundFacet } from "../rock/groundShares";
import { groundOf, type GroundDirection } from "../rock/ground";
import type { CompiledMix } from "../rock/modes";
import type { FlowCause, Pool } from "./flows";
import { settleRemovals, type GroundSource, type RemovalRequest } from "./stageRemoval";
import { MaterialLoad, loadOf } from "../rock/groundLoad";

/** Who is wearing the land, and which history band remembers it. */
export interface WearCause {
  readonly id: FlowCause;
  readonly remembers: MutablePhysicalBufferName;
  readonly pastBaseLevel?: boolean;
}
interface Removal extends RemovalRequest {
  recorded?: Band;
  wear?: WearCause;
  /** Source cell, destination cell and requested volume; destinations retain their actual source. */
  routes?: RecordQueue;
  cargo?: MaterialLoad;
}
interface Landing {
  from: "rock" | "crust";
  to: "loose" | "rock";
  cause: FlowCause;
  amount: Band;
  forcing?: { mix: CompiledMix; shieldDepth: number };
}
function land(map: PhysicalField, request: Landing, i: number, amount: number) {
  if (request.from === "rock")
    return request.forcing
      ? weatherRockBy(
          map,
          i,
          request.forcing.mix,
          amount,
          request.forcing.shieldDepth,
          request.cause
        )
      : weatherRock(map, i, amount, request.cause);
  return raiseFromCrust(map, i, amount, request.cause);
}
function incisionBands(map: PhysicalField, key: string) {
  return {
    share: workingArray(map, "float64", `stage:${key}:share`).fill(0),
    deepened: workingArray(map, "float64", `stage:${key}:deepened`).fill(0),
  };
}
const removalKey = (
  from: GroundSource,
  cause: FlowCause,
  wear: WearCause | undefined,
  routed: boolean,
  facet: GroundFacet | undefined,
  incision: boolean
) =>
  `${cause}|${from}|${Boolean(wear?.pastBaseLevel)}|${wear?.remembers ?? ""}|${routed}|${facet ?? "all"}|${incision}`;

/**
 * Commands land only on settlement. Surface wear strips cover then rock; explicit loose removal
 * cannot cut rock. Soil is a skin of those substrates, not another independent supply pool.
 * Routed moves retain source and destination, so competition affects only that source's outflow.
 * Removal depths decide against the starting field. Deferred weathering retains climate forcing,
 * then the remaining substrate answers it after removals and routed deposits. Sequential stages
 * grant each pool in submission order; actBy runs separate stages for sequential processes.
 */
export class Stage {
  private readonly removals = new Map<string, Removal>();
  private readonly landings = new Map<string, Landing>();
  // hpc-exempt: stage-local operation parameters, never per-cell material or numerical storage.
  private readonly forcings: NonNullable<Landing["forcing"]>[] = [];
  constructor(
    private readonly map: PhysicalField,
    private readonly options: { readonly simultaneous: boolean }
  ) {}
  get simultaneous() {
    return this.options.simultaneous;
  }
  private removal(
    from: GroundSource,
    cause: FlowCause,
    wear?: WearCause,
    routed = false,
    facet?: GroundFacet,
    incision = false
  ) {
    const pastBaseLevel = Boolean(wear?.pastBaseLevel),
      key = removalKey(from, cause, wear, routed, facet, incision);
    let request = this.removals.get(key);
    if (!request) {
      request = {
        from,
        cause,
        wear,
        facet,
        pastBaseLevel,
        amount: workingArray(this.map, "float64", `stage:${key}`).fill(0),
        routes: routed ? new RecordQueue(2) : undefined,
        cargo: routed ? new MaterialLoad(this.map, `stage:${key}:cargo`) : undefined,
        incision: incision ? incisionBands(this.map, key) : undefined,
      };
      if (wear) request.recorded = workingArray(this.map, "float64", `stage:record:${key}`).fill(0);
      this.removals.set(key, request);
    }
    return request;
  }
  /** Local transformations or withdrawals; existing cargo requires a material-bearing deposit or route. */
  demand(from: Pool, to: Pool, cell: number, amount: number, cause: FlowCause) {
    if (to === "load" && (from === "loose" || from === "rock")) {
      if (amount > 0) this.removal(from, cause).amount.add(cell, amount);
      return;
    }
    if (!((from === "rock" && to === "loose") || (from === "crust" && to === "rock")))
      throw new Error(`Unsupported stage transfer: ${from} -> ${to}`);
    if (amount <= 0) return;
    this.landing(from, to, cause).amount.add(cell, amount);
  }
  private landing(
    from: Landing["from"],
    to: Landing["to"],
    cause: FlowCause,
    forcing?: Landing["forcing"]
  ) {
    const key = `${cause}|${from}|${to}|${forcing ? this.forcingKey(forcing) : "depth"}`;
    let request = this.landings.get(key);
    if (!request) {
      request = {
        from,
        to,
        cause,
        forcing,
        amount: workingArray(this.map, "float64", `stage:${key}`).fill(0),
      };
      this.landings.set(key, request);
    }
    return request;
  }
  private forcingKey(forcing: NonNullable<Landing["forcing"]>) {
    const index = this.forcings.findIndex(
      (held) => held.mix === forcing.mix && held.shieldDepth === forcing.shieldDepth
    );
    if (index >= 0) return index;
    return this.forcings.push(forcing) - 1;
  }
  /** Climate forcing is captured now; remaining material answers it when conversion settles. */
  weatherAction(
    cell: number,
    mix: CompiledMix,
    power: number,
    shieldDepth: number,
    cause: FlowCause
  ) {
    if (power > 0)
      this.landing("rock", "loose", cause, { mix, shieldDepth }).amount.add(cell, power);
  }
  /** Surface lowering and its separately measured history, resolved after all demands arrive. */
  wear(cause: WearCause, cell: number, lowering: number, recorded = lowering) {
    if (lowering <= 0) return;
    const request = this.removal("surface", cause.id, cause);
    request.amount.add(cell, lowering);
    request.recorded!.add(cell, recorded);
  }
  /** Each occupied surface answers the same forcing before any pending action changes it. */
  attack(
    cause: WearCause,
    cell: number,
    mix: CompiledMix,
    power: number,
    limit: number,
    direction?: GroundDirection
  ) {
    const depths = groundOf(this.map).surfaceAction(cell, mix, power, limit, -Infinity, direction);
    for (const [index, facet] of (["land", "cut"] as const).entries()) {
      const amount = depths[index] * facetShare(this.map, cell, facet);
      if (amount <= 0) continue;
      const request = this.removal("surface", cause.id, cause, false, facet);
      request.amount.add(cell, amount);
      request.recorded!.add(cell, amount);
    }
  }
  /** Keep local depth and footprint until settlement; the floor and surviving cap stay distinct. */
  cut(cause: WearCause, cell: number, depth: number, share: number, remember = true) {
    if (depth <= 0 || share <= 0) return;
    const covered = Math.min(1, share),
      amount = depth * covered,
      request = this.removal("surface", cause.id, cause, false, undefined, true);
    request.amount.add(cell, amount);
    request.incision!.share.set(cell, Math.max(request.incision!.share.get(cell), covered));
    if (remember) request.recorded!.add(cell, amount);
  }
  /** Carries loose cover only; each destination receives what its own source was granted. */
  moveLoose(source: number, target: number, volume: number, cause: FlowCause) {
    this.route("loose", source, target, volume, cause);
  }
  /** Slope failure carries the surface's cover and then rock, rather than pretending it is all rock. */
  moveSurface(
    source: number,
    target: number,
    volume: number,
    cause: FlowCause,
    facet?: GroundFacet
  ) {
    this.route("surface", source, target, volume, cause, facet);
  }
  private route(
    from: GroundSource,
    source: number,
    target: number,
    volume: number,
    cause: FlowCause,
    facet?: GroundFacet
  ) {
    if (volume <= 0) return;
    const request = this.removal(from, cause, undefined, true, facet);
    request.amount.add(source, (volume * 1024) / this.map.mesh.area(source));
    request.routes!.push(source, target, volume);
  }
  /** Land withdrawals first, then their routed deposits and independent local transformations. */
  settle(): Map<FlowCause, number> {
    const requests = [...this.removals.values()],
      landed = settleRemovals(this.map, requests, this.simultaneous, (request, cell, material) => {
        const cargo = (request as Removal).cargo ?? loadOf(this.map);
        cargo.add(cell, { ...material, depth: (material.depth / 1024) * this.map.mesh.area(cell) });
      }),
      moved = new Map<FlowCause, number>();
    for (const request of requests) {
      const actual = landed.get(request)!;
      this.remember(request, actual, moved);
      this.landRoutes(request, actual);
      request.cargo?.release();
      releaseWorking(
        this.map,
        request.amount,
        actual,
        ...(request.recorded ? [request.recorded] : []),
        ...(request.incision ? [request.incision.share, request.incision.deepened] : [])
      );
    }
    for (const request of this.landings.values()) {
      for (let i = 0; i < this.map.mesh.count; i++) {
        const amount = request.forcing ? request.amount.get(i) : Math.round(request.amount.get(i));
        if (amount > 0) land(this.map, request, i, amount);
      }
      releaseWorking(this.map, request.amount);
    }
    this.removals.clear();
    this.landings.clear();
    this.forcings.length = 0;
    return moved;
  }
  private remember(request: Removal, actual: Band, moved: Map<FlowCause, number>) {
    let sum = 0;
    for (let i = 0; i < this.map.mesh.count; i++) {
      const taken = actual.get(i);
      sum += taken;
      if (taken <= 0) continue;
      // Routed material lands here; un-routed withdrawals feed the later carrier process.
      this.map.SedimentProducedTotal += (taken / 1024) * this.map.mesh.area(i);
      if (!request.wear) continue;
      this.map[request.wear.remembers].add(
        i,
        (request.recorded!.get(i) * (request.incision?.deepened.get(i) ?? taken)) /
          request.amount.get(i)
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
      const offered = volume * granted,
        material = request.cargo!.get(source),
        received =
          (deposit(
            this.map,
            target,
            (volume * granted * 1024) / this.map.mesh.area(target),
            request.cause,
            "load",
            material
          ) /
            1024) *
          this.map.mesh.area(target);
      if (received < offered)
        loadOf(this.map).add(source, { ...material, depth: offered - received });
    }
  }
}

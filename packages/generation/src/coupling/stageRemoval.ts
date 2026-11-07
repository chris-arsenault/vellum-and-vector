import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { units } from "../world/math";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { removeLoose, removeRock } from "../rock/groundLedger";
import type { FlowCause } from "./flows";

export type GroundSource = "surface" | "loose" | "rock";
export interface RemovalRequest {
  readonly from: GroundSource;
  readonly cause: FlowCause;
  readonly amount: Band;
  readonly pastBaseLevel: boolean;
}
interface Removal {
  request: RemovalRequest;
  from: "loose" | "rock";
  amount: Band;
  granted: Band;
}

/** Split the whole source request once, after every outgoing route has been submitted. */
function split(map: PhysicalField, request: RemovalRequest): Removal[] {
  const pools = request.from === "surface" ? (["loose", "rock"] as const) : [request.from];
  return pools.map((from) => {
    const amount = workingArray(map, "float64", `stage:${request.cause}:${from}:split`),
      granted = workingArray(map, "float64", `stage:${request.cause}:${from}:grant`);
    for (let i = 0; i < map.mesh.count; i++) {
      const wanted = request.amount.get(i),
        cover = Math.max(0, map.SedimentThickness.get(i));
      amount.set(
        i,
        request.from !== "surface"
          ? wanted
          : from === "loose"
            ? Math.min(wanted, cover)
            : Math.max(0, wanted - cover)
      );
    }
    return { request, from: from as "loose" | "rock", amount, granted };
  });
}
function supply(map: PhysicalField, removal: Removal, i: number) {
  const cover = Math.max(0, map.SedimentThickness.get(i));
  if (removal.request.pastBaseLevel || map.WaterKindCodes.get(i) === 1)
    return removal.from === "loose" ? cover : Infinity;
  const aboveBase = Math.max(0, map.Elevation.get(i) - map.EffectiveSeaLevel - units(1));
  return removal.from === "loose" ? Math.min(cover, aboveBase) : Math.max(0, aboveBase - cover);
}
function allocate(map: PhysicalField, removals: Removal[], simultaneous: boolean) {
  if (!removals.length) return;
  for (let i = 0; i < map.mesh.count; i++) {
    let total = 0,
      used = 0;
    for (const removal of removals) total += removal.amount.get(i);
    if (!total) continue;
    for (const removal of removals) {
      const wanted = removal.amount.get(i),
        available = supply(map, removal, i);
      const granted = simultaneous
        ? wanted * Math.min(1, available / total)
        : Math.min(wanted, Math.max(0, available - used));
      removal.granted.set(i, granted);
      used += granted;
    }
  }
}
/** Allocate from the starting field, then remove cover before rock, preserving each source command. */
export function settleRemovals(
  map: PhysicalField,
  requests: readonly RemovalRequest[],
  simultaneous: boolean
) {
  const removals = requests.flatMap((request) => split(map, request)),
    loose = removals.filter((removal) => removal.from === "loose"),
    rock = removals.filter((removal) => removal.from === "rock"),
    landed = new Map(
      requests.map((request) => [
        request,
        workingArray(map, "float64", `stage:${request.cause}:landed`).fill(0),
      ])
    );
  allocate(map, loose, simultaneous);
  allocate(map, rock, simultaneous);
  for (const removal of [...loose, ...rock]) {
    const remove = removal.from === "loose" ? removeLoose : removeRock,
      actual = landed.get(removal.request)!;
    for (let i = 0; i < map.mesh.count; i++) {
      const amount = Math.round(removal.granted.get(i));
      if (amount > 0) actual.add(i, remove(map, i, amount, removal.request.cause));
    }
    releaseWorking(map, removal.amount, removal.granted);
  }
  return landed;
}

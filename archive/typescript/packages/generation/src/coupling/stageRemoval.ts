import { MapScale, type Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { cutGround, removeLoose, removeRock } from "../rock/groundLedger";
import { incisionDemand } from "../rock/groundIncision";
import type { FlowCause } from "./flows";
import type { MaterialLayer } from "../rock/rockColumn";
import {
  columnThickness,
  coverColumn,
  facetShare,
  facetSurface,
  type GroundFacet,
} from "../rock/groundShares";

export type GroundSource = "surface" | "loose" | "rock";
export interface RemovalRequest {
  readonly from: GroundSource;
  readonly cause: FlowCause;
  readonly amount: Band;
  readonly pastBaseLevel: boolean;
  readonly facet?: GroundFacet;
  readonly incision?: { share: Band; deepened: Band };
}
interface Removal {
  request: RemovalRequest;
  from: "loose" | "rock";
  amount: Band;
  granted: Band;
  facet: GroundFacet;
}
const occupies = (request: RemovalRequest, facet: GroundFacet, share: number) =>
  share > 0 && (!request.facet || request.facet === facet);

const baseLevel = (map: PhysicalField, request: RemovalRequest, cell: number) =>
  request.pastBaseLevel || map.WaterKindCodes.get(cell) === 1
    ? -Infinity
    : map.EffectiveSeaLevel + MapScale.native(map.scale.length(2.5e-7));
function requestedDepth(
  map: PhysicalField,
  request: RemovalRequest,
  cell: number,
  facet: GroundFacet
) {
  const fraction = facetShare(map, cell, facet);
  if (fraction <= 0) return 0;
  return request.amount.get(cell) / (request.facet ? fraction : 1);
}
function incisionPool(
  map: PhysicalField,
  request: RemovalRequest,
  cell: number,
  facet: GroundFacet
) {
  return request.incision
    ? incisionDemand(
        map,
        cell,
        request.amount.get(cell),
        request.incision.share.get(cell),
        baseLevel(map, request, cell)
      )[facet]
    : undefined;
}

/** Split the whole source request once, after every outgoing route has been submitted. */
function split(map: PhysicalField, request: RemovalRequest): Removal[] {
  const pools = request.from === "surface" ? (["loose", "rock"] as const) : [request.from];
  return (["land", "cut"] as const).flatMap((facet) =>
    pools.map((from) => {
      const amount = workingArray(map, "float64", `stage:${request.cause}:${facet}:${from}:split`),
        granted = workingArray(map, "float64", `stage:${request.cause}:${facet}:${from}:grant`);
      for (let i = 0; i < map.mesh.count; i++) {
        const fraction = facetShare(map, i, facet),
          wanted = requestedDepth(map, request, i, facet),
          cover = columnThickness(map, i, coverColumn(facet)),
          present = occupies(request, facet, fraction),
          looseShare = map.SedimentThickness.get(i) > 0 ? cover / map.SedimentThickness.get(i) : 0,
          incision = incisionPool(map, request, i, facet);
        amount.set(
          i,
          !present
            ? 0
            : incision
              ? incision[from as "loose" | "rock"] / fraction
              : request.from !== "surface"
                ? wanted * (from === "loose" ? looseShare : 1)
                : from === "loose"
                  ? Math.min(wanted, cover)
                  : Math.max(0, wanted - cover)
        );
      }
      return { request, from: from as "loose" | "rock", amount, granted, facet };
    })
  );
}
function supply(map: PhysicalField, removal: Removal, i: number) {
  const cover = columnThickness(map, i, coverColumn(removal.facet));
  if (removal.request.pastBaseLevel || map.WaterKindCodes.get(i) === 1)
    return removal.from === "loose" ? cover : Infinity;
  const aboveBase = Math.max(
    0,
    facetSurface(map, i, removal.facet) -
      map.EffectiveSeaLevel -
      MapScale.native(map.scale.length(2.5e-7))
  );
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
  simultaneous: boolean,
  receive?: (request: RemovalRequest, cell: number, material: MaterialLayer) => void
) {
  const removals = requests.flatMap((request) => split(map, request)),
    soil = map.coverage.copyBand(map.SoilDepth),
    loose = removals.filter((removal) => removal.from === "loose"),
    rock = removals.filter((removal) => removal.from === "rock"),
    landed = new Map(
      requests.map((request) => [
        request,
        workingArray(map, "float64", `stage:${request.cause}:landed`).fill(0),
      ])
    );
  for (const facet of ["land", "cut"] as const) {
    allocate(
      map,
      loose.filter((removal) => removal.facet === facet),
      simultaneous
    );
    allocate(
      map,
      rock.filter((removal) => removal.facet === facet),
      simultaneous
    );
  }
  for (const removal of [...loose, ...rock]) {
    const remove = removal.from === "loose" ? removeLoose : removeRock,
      actual = landed.get(removal.request)!;
    for (let i = 0; i < map.mesh.count; i++) {
      const amount = Math.round(removal.granted.get(i));
      if (removal.request.incision) {
        actual.add(i, amount * facetShare(map, i, removal.facet));
        continue;
      }
      if (amount > 0)
        actual.add(
          i,
          remove(
            map,
            i,
            amount,
            removal.request.cause,
            receive ? (material) => receive(removal.request, i, material) : undefined,
            removal.facet,
            soil.get(i)
          )
        );
    }
    releaseWorking(map, removal.amount, removal.granted);
  }
  settleIncisions(map, requests, landed, receive);
  releaseWorking(map, soil);
  return landed;
}

/** All requests were allocated from the starting facets; accepted cuts precede every landing. */
function settleIncisions(
  map: PhysicalField,
  requests: readonly RemovalRequest[],
  landed: Map<RemovalRequest, Band>,
  receive?: (request: RemovalRequest, cell: number, material: MaterialLayer) => void
) {
  for (const request of requests) {
    if (!request.incision) continue;
    const actual = landed.get(request)!;
    for (let cell = 0; cell < map.mesh.count; cell++) {
      const budget = actual.get(cell),
        share = request.incision.share.get(cell);
      if (budget <= 0 || share <= 0) continue;
      const cut = cutGround(
        map,
        cell,
        budget / share,
        share,
        request.cause,
        receive ? (material) => receive(request, cell, material) : undefined,
        baseLevel(map, request, cell)
      );
      actual.set(cell, cut.amount);
      request.incision.deepened.set(cell, cut.depth);
    }
  }
}

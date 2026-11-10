import type { PhysicalField } from "../world/field";
import { adjustCrustColumn } from "./crustTransport";
import { clamp, crustPerRock, units } from "../world/math";
import { recordFlow, type FlowCause, type Pool } from "../coupling/flows";
import { layDownPackage, materialLayer, type MaterialLayer } from "./rockColumn";
import { rockCatalogue, type RockKind } from "./rockCatalogue";
import { withdrawColumn, type MaterialReceiver } from "./groundMaterial";
export { buryCover, lithify, lithifyBuried } from "./groundBurial";
import {
  coverColumn,
  columnThickness,
  facetShare,
  facetSurface,
  projectGround,
  type GroundFacet,
} from "./groundShares";
import { loadOf, seaLoadOf } from "./groundLoad";
import { widenIncision } from "./groundIncision";
import { groundStorage } from "./groundStorage";
import { groundOf } from "./ground";
import type { CompiledMix } from "./modes";
import { constructMaterial, depositedMaterial } from "./groundConstruction";
import { extractColumn, type GroundExtraction } from "./groundExtraction";
import { releasedMaterial } from "./groundCargoIdentity";
import {
  availableCrust,
  lowerRock,
  settleWithdrawal,
  withdrawalReceiver,
} from "./groundWithdrawal";
export { availableCrust } from "./groundWithdrawal";
export { constructMaterial } from "./groundConstruction";
export { alterGround, type GroundAlteration } from "./groundAlteration";

/**
 * The one writer of what comes off and lands on the ground: height, sediment, the rock column and
 * the sediment's books stay consistent because they change together here.
 */

const volumeOf = (map: PhysicalField, i: number, height: number) =>
  MapScale.metres(height, "native") * map.mesh.area(i);
/**
 * Takes material off a cell, as a lowering of its mean height: the soil first, which is the top of
 * whatever lies there, then the rest of the loose cover, then rock.
 */
export function erode(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause,
  to: Pool = "load",
  receive?: MaterialReceiver
): number {
  return erodeFacets(map, i, [requested, requested], cause, to, receive);
}
/** Remove separately evaluated local depths; each facet keeps its material response. */
export function erodeFacets(
  map: PhysicalField,
  i: number,
  depths: readonly [number, number],
  cause: FlowCause,
  to: Pool = "load",
  receive?: MaterialReceiver
): number {
  const skin = map.SoilDepth.get(i);
  let removed = 0;
  for (const [index, facet] of (["land", "cut"] as const).entries())
    if (facetShare(map, i, facet) > 0 && depths[index] > 0)
      removed += removeFacet(map, i, facet, depths[index], cause, to, "surface", receive, skin);
  projectGround(map, i);
  return removed;
}
/** Removes loose substrate only. Soil is a skin over that substrate, not an additional stock. */
export function removeLoose(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause,
  receive?: MaterialReceiver,
  only?: GroundFacet,
  skin = map.SoilDepth.get(i)
) {
  let removed = 0;
  for (const facet of only ? [only] : (["land", "cut"] as const))
    if (facetShare(map, i, facet) > 0)
      removed += removeFacet(map, i, facet, requested, cause, "load", "loose", receive, skin);
  projectGround(map, i);
  return removed;
}
/** Removes rock beneath any remaining loose cover; only the soil skin within rock goes with it. */
export function removeRock(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause,
  receive?: MaterialReceiver,
  only?: GroundFacet,
  skin = map.SoilDepth.get(i)
) {
  if (!only) return excavateRock(map, i, requested, cause, "load", receive);
  const actual = removeFacet(map, i, only, requested, cause, "load", "rock", receive, skin);
  projectGround(map, i);
  return actual;
}
/** Remove from one represented share; emitted thickness is already weighted to the whole cell. */
function removeFacet(
  map: PhysicalField,
  i: number,
  facet: GroundFacet,
  requested: number,
  cause: FlowCause,
  to: Pool,
  source: "surface" | "loose" | "rock",
  receive?: MaterialReceiver,
  skin = map.SoilDepth.get(i)
) {
  const share = facetShare(map, i, facet),
    covered = columnThickness(map, i, coverColumn(facet)),
    exposedSoil = Math.max(0, units(skin) - (source === "rock" ? covered : 0)),
    accept = withdrawalReceiver(map, i, share, to, receive),
    loose = source === "rock" ? 0 : withdrawColumn(map, i, coverColumn(facet), requested, accept),
    rock =
      source === "loose"
        ? 0
        : withdrawColumn(map, i, facet, Math.max(0, requested - loose), accept);
  settleWithdrawal(map, i, facet, loose, rock, Math.min(loose + rock, exposedSoil), cause, to);
  return (loose + rock) * share;
}
/** A soluble or separable constituent leaves its finite bed; retained caps settle above it. */
export function extractGround(
  map: PhysicalField,
  cell: number,
  action: GroundExtraction,
  cause: FlowCause,
  to: Pool = "load",
  receive?: MaterialReceiver
) {
  const skin = units(map.SoilDepth.get(cell));
  let removed = 0;
  for (const facet of ["land", "cut"] as const) {
    const share = facetShare(map, cell, facet);
    if (share <= 0) continue;
    const accept = withdrawalReceiver(map, cell, share, to, receive, true),
      cover = coverColumn(facet),
      covered = columnThickness(map, cell, cover),
      surface = groundOf(map).section(cell, facet)[0],
      reach = action.surfaceOnly ? Math.min(action.reach, surface?.depth ?? 0) : action.reach,
      loose = extractColumn(map, cell, cover, { ...action, reach }, skin, accept, share),
      rock = extractColumn(
        map,
        cell,
        facet,
        {
          ...action,
          amount: Math.max(0, action.amount - loose.removed),
          reach:
            action.looseOnly || (action.surfaceOnly && covered > 0)
              ? 0
              : Math.max(0, reach - covered),
        },
        Math.max(0, skin - covered),
        accept,
        share
      );
    settleWithdrawal(
      map,
      cell,
      facet,
      loose.removed,
      rock.removed,
      loose.soil + rock.soil,
      cause,
      to
    );
    removed += (loose.removed + rock.removed) * share;
  }
  projectGround(map, cell);
  return removed;
}
export function excavateRock(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause,
  to: Pool = "load",
  receive?: MaterialReceiver
) {
  const skin = map.SoilDepth.get(i);
  let removed = 0;
  for (const facet of ["land", "cut"] as const)
    if (facetShare(map, i, facet) > 0)
      removed += removeFacet(
        map,
        i,
        facet,
        Math.max(0, requested),
        cause,
        to,
        "rock",
        receive,
        skin
      );
  projectGround(map, i);
  return removed;
}
/**
 * Lays the supplied loose material on the receiving cell or occupied facet.
 */
export function deposit(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause,
  from: Pool = "load",
  material: MaterialLayer = materialLayer(rockCatalogue.alluvium.code, requested),
  facet?: GroundFacet
): number {
  return depositPackage(map, i, [{ ...material, depth: requested }], cause, from, facet);
}
/** A top-first package keeps its bed order as it joins the receiving cover. */
export function depositPackage(
  map: PhysicalField,
  i: number,
  materials: readonly MaterialLayer[],
  cause: FlowCause,
  from: Pool = "load",
  facet?: GroundFacet
): number {
  if (facet && facetShare(map, i, facet) <= 0) return 0;
  const admitted = materials
      .filter((material) => material.depth > 0)
      .map((material) => depositedMaterial(material, map.CompletedEpochCount)),
    deposited = admitted.reduce((total, material) => total + material.depth, 0);
  if (deposited <= 0) return 0;
  for (const part of facet ? [facet] : (["land", "cut"] as const)) {
    const share = facetShare(map, i, part);
    if (share <= 0) continue;
    layDownPackage(
      map,
      i,
      coverColumn(part),
      facet ? admitted.map((layer) => ({ ...layer, depth: layer.depth / share })) : admitted
    );
  }
  recordFlow(map, cause, from, "loose", volumeOf(map, i, deposited));
  map.CumulativeDeposition.add(i, deposited);
  map.SedimentDepositedTotal += MapScale.metres(deposited, "native") * map.mesh.area(i);
  projectGround(map, i);
  return deposited;
}
/** Takes a lowering off a cell and feeds what came off to the sediment on the move. */
export function wearAway(map: PhysicalField, i: number, lowering: number, cause: FlowCause) {
  const worn = erode(map, i, lowering, cause);
  map.SedimentProducedTotal += MapScale.metres(worn, "native") * map.mesh.area(i);
  return worn;
}
/**
 * A channel cut to `depth` across `share` of the cell. A cell's height is the mean of its ground, so
 * that mean falls by the depth over that share only; the depth itself is remembered as incision.
 */
export function recordCut(
  map: PhysicalField,
  i: number,
  depth: number,
  share: number,
  cause: FlowCause
) {
  const actual = cutGround(map, i, depth, share, cause);
  map.CumulativeFluvialErosion.add(i, actual.depth);
  map.SedimentProducedTotal += volumeOf(map, i, actual.amount);
}
/** Widening pays for the newly cut material before any remaining work deepens the floor. */
export function cutGround(
  map: PhysicalField,
  i: number,
  depth: number,
  share: number,
  cause: FlowCause,
  receive?: MaterialReceiver,
  minimumSurface = -Infinity
) {
  if (depth <= 0 || share <= 0) return { amount: 0, depth: 0 };
  const budget = depth * clamp(share, 0, 1),
    accept = (taken: MaterialLayer) => {
      const material = releasedMaterial(map, taken);
      if (receive) receive(material);
      else loadOf(map).add(i, { ...material, depth: volumeOf(map, i, material.depth) });
    },
    widened = widenIncision(map, i, share, budget, minimumSurface, accept);
  if (widened.share <= 0) return { amount: 0, depth: 0 };
  if (widened.rock > 0) lowerRock(map, i, widened.rock);
  map.SoilDepth.set(i, Math.max(0, map.SoilDepth.get(i) - widened.soil));
  recordFlow(map, cause, "loose", "load", volumeOf(map, i, widened.loose));
  recordFlow(map, cause, "rock", "load", volumeOf(map, i, widened.rock));
  const room = Math.max(0, facetSurface(map, i, "cut") - minimumSurface),
    local = Math.min(Math.max(0, budget - widened.amount) / widened.share, room),
    deepened = removeFacet(
      map,
      i,
      "cut",
      local,
      cause,
      "load",
      "surface",
      receive,
      widened.cutSkin
    );
  projectGround(map, i);
  return { amount: widened.amount + deepened, depth: deepened / widened.share };
}
/** What is being carried leaves the map or goes out to sea, by volume. */
export function carryOut(
  map: PhysicalField,
  volume: number,
  cause: FlowCause,
  material?: MaterialLayer,
  receivingCell = -1
) {
  map.SedimentExportedTotal += volume;
  if (material && volume > 0 && receivingCell >= 0)
    seaLoadOf(map).add(receivingCell, { ...material, depth: volume });
  recordFlow(map, cause, "load", "sea", volume);
}
/** Failed ground leaves a cell by volume, to rest on its neighbours. */
export function shed(map: PhysicalField, i: number, volume: number, cause: FlowCause) {
  erode(map, i, MapScale.inUnits(volume / map.mesh.area(i), "native"), cause, "loose");
  map.SedimentProducedTotal += volume;
}
/** Failed ground comes to rest on a cell, by volume. */
export function settle(map: PhysicalField, i: number, volume: number) {
  deposit(map, i, MapScale.inUnits(volume / map.mesh.area(i), "native"), "slopes");
}
/** Construction creates an actual bed and its placement in the same operation. */
export function constructRock(
  map: PhysicalField,
  i: number,
  requested: number,
  kind: RockKind,
  cause: FlowCause,
  from: Pool
) {
  return constructMaterial(
    map,
    i,
    materialLayer(kind.code, requested, {}, map.CompletedEpochCount),
    cause,
    from
  );
}
/**
 * A cell's crust stands up as rock on it, as far as it has crust piled up to give,
 * and says how much stood: nothing stands that was not there to move.
 */
export function raiseFromCrust(map: PhysicalField, i: number, wanted: number, cause: FlowCause) {
  const perRock = crustPerRock(map.CrustContinentalFraction.get(i) / 1000),
    amount = Math.min(wanted, availableCrust(map, i) / perRock);
  if (amount <= 0) return 0;
  adjustCrustColumn(map, i, map.CrustThickness.get(i) - amount * perRock);
  groundStorage(map).SurfaceRockLoad.add(i, amount);
  displaceGround(map, i, amount, cause);
  return amount;
}
/**
 * The ground moves with no rock made or lost: it sags as what is under it goes, or lifts as something
 * rises beneath it. What it stands on takes the difference.
 */
export function displaceGround(map: PhysicalField, i: number, amount: number, cause: FlowCause) {
  groundStorage(map).BedrockElevation.add(i, amount);
  recordFlow(map, cause, "crust", "crust", volumeOf(map, i, Math.abs(amount)));
  projectGround(map, i);
}
/** The ground comes to stand at `elevation`, its loose cover kept and its rock taking the change. */
export function standGround(map: PhysicalField, i: number, elevation: number, cause: FlowCause) {
  const change = elevation - (map.BedrockElevation.get(i) + map.SedimentThickness.get(i));
  if (change !== 0) displaceGround(map, i, change, cause);
  else projectGround(map, i);
}
/** Rock already standing moves with what carries it: plates or a thrust sheet, piling or thinning. */
export function shiftRock(map: PhysicalField, i: number, change: number, cause: FlowCause) {
  groundStorage(map).BedrockElevation.add(i, change);
  groundStorage(map).SurfaceRockLoad.add(i, change);
  recordFlow(map, cause, "rock", "rock", volumeOf(map, i, Math.abs(change)));
  projectGround(map, i);
}
/** A cell's loose cover comes to `thickness`: laid where it grows, taken where it thins. */
export function looseTo(map: PhysicalField, i: number, thickness: number, cause: FlowCause) {
  const change = Math.max(0, thickness) - map.SedimentThickness.get(i);
  if (change > 0) deposit(map, i, change, cause);
  else if (change < 0) erode(map, i, -change, cause);
}
/**
 * Rock turning to loose cover where it stands: the column loses it and the mantle gains it, and the
 * ground stays where it is. It is now what slopes, water and wind take first.
 */
export function weatherRock(map: PhysicalField, i: number, amount: number, cause: FlowCause) {
  return weatherRockFacets(map, i, [amount, amount], cause);
}
/** Captured forcing acts on the substrate remaining after the stage's removals and routed deposits. */
export function weatherRockBy(
  map: PhysicalField,
  i: number,
  mix: CompiledMix,
  power: number,
  shieldDepth: number,
  cause: FlowCause
) {
  const ground = groundOf(map),
    depths: [number, number] = [0, 0];
  for (const [index, facet] of (["land", "cut"] as const).entries()) {
    const mantle = MapScale.metres(ground.coverDepth(i, facet), "native"),
      shield = Math.exp(-mantle / shieldDepth);
    depths[index] = ground.rockAction(i, mix, power * shield, Infinity, facet);
  }
  return weatherRockFacets(map, i, depths, cause);
}
/** Local rock depths become substrate beneath the existing cover, retaining their bed order. */
export function weatherRockFacets(
  map: PhysicalField,
  i: number,
  depths: readonly [number, number],
  cause: FlowCause
) {
  let converted = 0;
  for (const [index, facet] of (["land", "cut"] as const).entries()) {
    const share = facetShare(map, i, facet);
    if (share <= 0 || depths[index] <= 0) continue;
    const cover = coverColumn(facet),
      layers: MaterialLayer[] = [];
    withdrawColumn(map, i, cover, columnThickness(map, i, cover), (layer) => layers.push(layer));
    const actual = withdrawColumn(map, i, facet, depths[index], (layer) => layers.push(layer));
    layDownPackage(map, i, cover, layers);
    converted += actual * share;
    groundStorage(map).GroundCutDepth.add(i, facet === "cut" ? actual : -actual);
  }
  groundStorage(map).BedrockElevation.add(i, -converted);
  groundStorage(map).SurfaceRockLoad.add(
    i,
    -Math.min(converted, Math.max(0, map.SurfaceRockLoad.get(i)))
  );
  recordFlow(map, cause, "rock", "loose", volumeOf(map, i, converted));
  projectGround(map, i);
  return converted;
}
import { MapScale } from "@atlas/domain";

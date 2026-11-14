import { MapScale, requireThat } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { deposit, displaceGround, erode, removeLoose } from "./groundLedger";
import { loadOf } from "./groundLoad";
import { alterRock } from "./rockField";
import { meltIce, spoilSoil } from "./groundSurfaceMedia";

export type GroundTargetBand =
  "Elevation" | "SedimentThickness" | "RockResistance" | "IceThickness" | "SoilDepth";
export const isGroundTarget = (name: string): name is GroundTargetBand =>
  ["Elevation", "SedimentThickness", "RockResistance", "IceThickness", "SoilDepth"].includes(name);
export interface GroundTarget {
  add: number;
  atMost: number;
  atLeast: number;
}
/** A new command applies against present material without remembering a maintained request. */
export function executeGroundTarget(
  map: PhysicalField,
  name: GroundTargetBand,
  cell: number,
  target: GroundTarget
) {
  const current = map[name].get(cell),
    next = Math.min(target.atMost, Math.max(target.atLeast, current + target.add));
  if (next !== current) settleTarget(map, name, cell, next - current, "place-event");
}
const settled = new WeakMap<PhysicalField, Map<GroundTargetBand, Float64Array>>();

/** A smaller or ended request never reverses a material operation already performed. */
export function unsettledAddition(request: number, previous: number) {
  return request > 0
    ? Math.max(0, request - Math.max(0, previous))
    : Math.min(0, request - Math.min(0, previous));
}

/** Place requests are persistent ground operations, never reversible scalar overlays. */
export function realizeGroundTarget(
  map: PhysicalField,
  name: GroundTargetBand,
  cell: number,
  target: GroundTarget
) {
  let byBand = settled.get(map);
  if (!byBand) settled.set(map, (byBand = new Map()));
  let applied = byBand.get(name);
  if (!applied) byBand.set(name, (applied = new Float64Array(map.mesh.count)));
  if (target.add * applied[cell] < 0) applied[cell] = 0;
  const current = map[name].get(cell),
    pending = unsettledAddition(target.add, applied[cell]);
  const next = Math.min(target.atMost, Math.max(target.atLeast, current + pending));
  const delta = next - current;
  if (!delta) return;
  settleTarget(map, name, cell, delta, "places");
  const changed = map[name].get(cell) - current;
  if (changed * pending > 0)
    applied[cell] += Math.sign(pending) * Math.min(Math.abs(changed), Math.abs(pending));
}

/** Ground geometry, its soil skin and overlying ice use their existing settlement owners. */
function settleTarget(
  map: PhysicalField,
  name: GroundTargetBand,
  cell: number,
  delta: number,
  cause: string
) {
  if (name === "IceThickness" || name === "SoilDepth") {
    requireThat(
      delta <= 0,
      "ground_media_target",
      "A place can remove existing ice or soil skin; it cannot manufacture it."
    );
    if (name === "IceThickness") meltIce(map, cell, -delta, cause, true);
    else spoilSoil(map, cell, -delta / map.SoilDepth.get(cell), cause);
    return;
  }
  if (name === "SedimentThickness") {
    if (delta < 0) removeLoose(map, cell, -delta, cause);
    else landAvailable(map, cell, delta, cause);
  } else if (name === "RockResistance") alterRock(map, cell, delta);
  else if (delta < 0) erode(map, cell, -delta, cause);
  else displaceGround(map, cell, delta, cause);
}

/** A requested deposit can use actual local carried material only. */
function landAvailable(map: PhysicalField, cell: number, depth: number, cause: string) {
  const area = map.mesh.area(cell);
  if (area <= 0) return;
  const material = loadOf(map).take(cell, MapScale.metres(depth, "native") * area);
  if (material.depth > 0)
    deposit(map, cell, MapScale.native(material.depth / area), cause, "load", material);
}

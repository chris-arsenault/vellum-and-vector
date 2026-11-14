import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { LocateContext, SupplyContext } from "./magicSources";
import { exposure, heldStock, releaseShare, siteStrength } from "./magicStocks";
import { meshDeltaX, nearestTriangle } from "./mesh";
import { MapScale } from "@atlas/domain";
import type { MagicInventory } from "./magicInventory";
import { depositFallenCores, stockGroundHosts } from "../rock/rockMagicStock";
import { GroundInventory } from "../rock/groundInventory";
import { units } from "./math";

/**
 * Fallen cores. Each impact seeds a finite stock once, on the crater and its ejecta in
 * proportion to the ejecta's thickness and elongated downwind. Every evaluation the exposed
 * stock releases a share set by the cracking agents at work, and that release is the source
 * where it reaches the source floor: the crater and the thick near fan, the far fan only in
 * the epoch of the fall or under ice. The impact's own heat is a coreless source that fades
 * with the epochs since the fall. Stock the rivers wash thin below is stock, not a source.
 */
export function impactSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, epochIndex, activity }: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters,
    held = heldStock(field, origin);
  for (const event of map.events) {
    if (event.kind !== "impact" || event.epoch > epochIndex) continue;
    field.located.push({
      origin: "",
      id: event.id,
      x: event.x,
      y: event.y,
      radius: event.radius,
      strength: 1000,
    });
  }
  for (let i = 0; i < map.mesh.count; i++) {
    field.releasing.set(i, 0);
    let strength = 0;
    const stock = held.get(i);
    if (stock > 0) {
      const releasing =
        (held instanceof GroundInventory
          ? held.reached(i, units(p.buryDepth)) / stock
          : exposure(map, i, p.buryDepth, stockGroundHosts(field.definition.id, "held"))) *
        releaseShare(map, field, i, epochIndex);
      field.releasing.set(i, releasing);
      strength = (stock * releasing) / map.mesh.area(i);
    }
    const heat = map.ImpactHeat.get(i);
    if (heat > 0) {
      const since = Math.max(0, epochIndex - Math.max(0, field.arrival.get(i)));
      strength = Math.max(strength, (heat * p.impactHeatShare * activity) / (1 + since));
    }
    const site = siteStrength(strength);
    if (site > 0) field.source.set(i, site);
  }
}
/** Event eligibility is consumed even during an epoch with no new magic supply. */
export function supplyFallenCores(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin, epochIndex, activity }: SupplyContext
) {
  const map = state.physical!.map;
  for (const event of map.events) {
    if (event.kind !== "impact" || event.epoch > epochIndex || field.seeded.has(event.id)) continue;
    field.seeded.add(event.id);
    if (activity > 0)
      seedFallenStock(map, field, heldStock(field, origin), event, epochIndex, activity);
  }
}
function seedFallenStock(
  map: PhysicalField,
  field: MagicField,
  held: MagicInventory,
  event: PhysicalField["events"][number],
  epochIndex: number,
  activity: number
) {
  field.seeded.add(event.id);
  const centre = nearestTriangle(map.mesh, event.x, event.y);
  if (centre < 0) return;
  const p = field.definition.parameters,
    wx = map.WindX.get(centre) / 1000,
    wy = map.WindY.get(centre) / 1000;
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const dx = meshDeltaX(map.mesh, map.mesh.x(i) - event.x),
      dy = map.mesh.y(i) - event.y,
      distance = Math.hypot(dx, dy);
    if (distance > event.radius * 2.4) continue;
    const ejecta = MapScale.metres(map.ImpactEjectaThickness.get(i), "native"),
      downwind = distance > 0 ? Math.max(0, (dx * wx + dy * wy) / distance) : 0,
      amount = ejecta * map.mesh.area(i) * p.fallenDensity * (1 + 0.6 * downwind) * activity;
    if (amount <= 0) continue;
    depositFallenCores(map, held, i, amount, p.fallenDensity);
    total += amount;
    field.arrival.set(i, Math.max(field.arrival.get(i), epochIndex));
  }
  // The body itself: a fifth again of the fan's stock lies in the crater.
  depositFallenCores(map, held, centre, total * 0.2, p.fallenDensity);
  field.arrival.set(centre, Math.max(field.arrival.get(centre), epochIndex));
}

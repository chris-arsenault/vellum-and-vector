import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { LocateContext } from "./magicSources";
import { exposure, heldStock, releaseShare, siteStrength } from "./magicStocks";
import { meshDeltaX, nearestTriangle } from "./mesh";
import type { NumericalVector } from "@atlas/domain";

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
  { origin, epochIndex }: LocateContext
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
    if (!field.seeded.has(event.id)) seedFallenStock(map, field, held, event, epochIndex);
  }
  for (let i = 0; i < map.mesh.count; i++) {
    field.releasing[i] = 0;
    let strength = 0;
    if (held[i] > 0) {
      field.releasing[i] = exposure(map, i, p.buryDepth) * releaseShare(map, field, i, epochIndex);
      strength = (held[i] * field.releasing[i]) / map.mesh.areas[i];
    }
    if (map.ImpactHeat[i] > 0) {
      const since = Math.max(0, epochIndex - Math.max(0, field.arrival[i]));
      strength = Math.max(strength, (map.ImpactHeat[i] * p.impactHeatShare) / (1 + since));
    }
    const site = siteStrength(strength);
    if (site > 0) field.source[i] = site;
  }
}
function seedFallenStock(
  map: PhysicalField,
  field: MagicField,
  held: NumericalVector,
  event: PhysicalField["events"][number],
  epochIndex: number
) {
  field.seeded.add(event.id);
  const centre = nearestTriangle(map.mesh, event.x, event.y);
  if (centre < 0) return;
  const p = field.definition.parameters,
    wx = map.WindX[centre] / 1000,
    wy = map.WindY[centre] / 1000;
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const dx = meshDeltaX(map.mesh, map.mesh.x[i] - event.x),
      dy = map.mesh.y[i] - event.y,
      distance = Math.hypot(dx, dy);
    if (distance > event.radius * 2.4) continue;
    const ejecta = map.ImpactEjectaThickness[i] / 1024,
      downwind = distance > 0 ? Math.max(0, (dx * wx + dy * wy) / distance) : 0,
      amount = ejecta * map.mesh.areas[i] * p.fallenDensity * (1 + 0.6 * downwind);
    if (amount <= 0) continue;
    held[i] += amount;
    total += amount;
    field.arrival[i] = Math.max(field.arrival[i], epochIndex);
  }
  // The body itself: a fifth again of the fan's stock lies in the crater.
  held[centre] += total * 0.2;
  field.arrival[centre] = Math.max(field.arrival[centre], epochIndex);
}

import { gridPosition, type MagicSystem, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { samplesInBox } from "./societySpatial";
import { societyValue } from "./societySupport";

/**
 * What society asks of a system is a role its effects declare, never its name or the way
 * it propagates: the system that quickens is mined and forged, the one that stills is
 * read through its crystals, the one that moves water is dived.
 */
export type MagicRole = "quickens" | "stills" | "moves-water";
export const magicRoles: Record<MagicRole, (effects: MagicSystem["effects"]) => boolean> = {
  quickens: (e) => e.quickening > 0,
  stills: (e) => e.stillness > 0,
  "moves-water": (e) => e.upwelling > 0 || e.seaSurface !== 0 || e.fog > 0 || e.wakeWarming > 0,
};
/** The enabled system that fills this role, or none. */
export function magicSystemForRole(systems: MagicSystem[] | undefined, role: MagicRole) {
  return systems?.find((system) => system.enabled && magicRoles[role](system.effects));
}
export function systemHasRole(system: MagicSystem, role: MagicRole) {
  return magicRoles[role](system.effects);
}
/** The enabled system in this role, read at a sample in the field's own units. */
export function magicAt(state: GenerationState, role: MagicRole, i: number, channel = "intensity") {
  const system = magicSystemForRole(state.domain.world.magicSystems, role);
  return system ? societyValue(state, `magic:${system.id}:${channel}`, i) / 1000 : 0;
}
/** The nearest ocean sample within a community's reach that lies between 50 m and its depth limit. */
export function accessibleDive(state: GenerationState, c: SocietyCommunity, limit: number) {
  let best = -1,
    distance = Math.min(100000, Math.sqrt(c.areaKm2) * 1500);
  const { x, y } = c.position;
  for (const i of samplesInBox(state.surface, [
    x - distance,
    y - distance,
    x + distance,
    y + distance,
  ])) {
    const depth = societyValue(state, "waterDepth", i);
    if (societyValue(state, "water", i) !== 1 || depth < 50 || depth > limit) continue;
    const p = gridPosition(state.surface, i),
      d = Math.hypot(p.x - c.position.x, p.y - c.position.y);
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}

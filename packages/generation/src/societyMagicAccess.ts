import { gridPosition, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { samplesInBox } from "./societySpatial";
import { societyValue } from "./societySupport";

/** The enabled system that propagates this way, read at a sample in the field's own units. */
export function magicAt(
  state: GenerationState,
  propagation: string,
  i: number,
  channel = "intensity"
) {
  const system = state.domain.world.magicSystems?.find(
    (s) => s.enabled && s.propagation === propagation
  );
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

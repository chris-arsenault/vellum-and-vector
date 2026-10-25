import { gridPosition, type MagicSystem, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { samplesInBox } from "./societySpatial";
import { societyValue } from "./societySupport";
import { depositReservoir, drawReservoir, reservoirAmount } from "./canonry/magicState";

/**
 * What society asks of a system is a role its effects declare, never its name or the way
 * it propagates: the system that quickens is mined and forged, the one that stills is
 * read through its crystals, the one that moves water is dived.
 */
export type MagicRole = "quickens" | "stills" | "moves-water" | "greens" | "salts";
export const magicRoles: Record<MagicRole, (effects: MagicSystem["effects"]) => boolean> = {
  quickens: (e) => e.quickening > 0,
  stills: (e) => e.stillness > 0,
  "moves-water": (e) => e.upwelling > 0 || e.seaSurface !== 0 || e.fog > 0 || e.wakeWarming > 0,
  greens: (e) => e.verdure > 0,
  salts: (e) => e.salting > 0,
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
/** The live field of the enabled system in a role, where the mesh is live in this generation. */
export function magicFieldForRole(state: GenerationState, role: MagicRole) {
  const system = magicSystemForRole(state.domain.world.magicSystems, role);
  return state.physical?.magic?.fields.find((field) => field.definition.id === system?.id);
}
/** The mesh cell under a surface sample, or -1 without a live mesh. */
function cellOf(state: GenerationState, sample: number) {
  const cell = state.physical?.samples[sample];
  return sample >= 0 && cell !== undefined ? cell : -1;
}
function touch(state: GenerationState, systemId: string) {
  if (state.society) (state.society.magicTouched ??= new Set()).add(systemId);
}
/** The stock of a system's reservoir under a sample, as an amount. */
export function reservoirAt(
  state: GenerationState,
  role: MagicRole,
  reservoir: string,
  sample: number
) {
  const field = magicFieldForRole(state, role),
    cell = cellOf(state, sample);
  return field && cell >= 0 ? reservoirAmount(field, reservoir, cell) : 0;
}
/**
 * People take an amount of a system's reservoir out of the mesh under a sample: mining takes
 * held cores, gathering takes sap, clearance burns it. Returns what was taken.
 */
export function drawAt(
  state: GenerationState,
  role: MagicRole,
  reservoir: string,
  sample: number,
  amount: number
) {
  const field = magicFieldForRole(state, role),
    cell = cellOf(state, sample);
  if (!field || cell < 0 || amount <= 0) return 0;
  const drawn = drawReservoir(field, reservoir, cell, amount);
  if (drawn > 0) touch(state, field.definition.id);
  return drawn;
}
/** Take a share of what the reservoir holds under the sample. */
export function drawShareAt(
  state: GenerationState,
  role: MagicRole,
  reservoir: string,
  sample: number,
  share: number
) {
  return drawAt(
    state,
    role,
    reservoir,
    sample,
    reservoirAt(state, role, reservoir, sample) * share
  );
}
/** People leave an amount of a system in a reservoir under a sample: cracked cores, planted seed. */
export function depositAt(
  state: GenerationState,
  role: MagicRole,
  reservoir: string,
  sample: number,
  amount: number
) {
  const field = magicFieldForRole(state, role),
    cell = cellOf(state, sample);
  if (!field || cell < 0 || amount <= 0) return 0;
  const deposited = depositReservoir(field, reservoir, cell, amount);
  if (deposited > 0) touch(state, field.definition.id);
  return deposited;
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

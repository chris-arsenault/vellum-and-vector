import { population, type Position } from "@atlas/domain";
import type { GenerationState } from "./process";
import { nativeIndexAtSurface } from "./canonry/atlasWorkspace";

/**
 * What people leave on the ground, written to the mesh at the end of every society cycle as
 * amounts the crust carries on: person-years at each inhabited seat (tenure), traveller-years
 * on every cell a way crosses (walked routes), and the dead, once per event and once per
 * cycle of net population fall at a community (mass death). Society-sourced magic is made of
 * these; nothing here is a magic field of its own.
 */
export function recordSocietyOnMesh(state: GenerationState, years: number) {
  if (!state.physical || !state.society || years <= 0) return;
  const deaths = recordSeats(state, years) + recordEvents(state);
  walkRoutes(state, years);
  // A system made of the dead is re-evaluated when there are new dead to make it from.
  if (deaths > 0)
    for (const system of state.domain.world.magicSystems ?? [])
      if (system.enabled && system.origins.some((origin) => origin.source === "death"))
        (state.society.magicTouched ??= new Set()).add(system.id);
}
function cellAt(state: GenerationState, p: Pick<Position, "x" | "y">) {
  return nativeIndexAtSurface(state, p.x, p.y);
}
/** Person-years at every inhabited seat, and the cycle's die-offs where they happened. */
function recordSeats(state: GenerationState, years: number) {
  const map = state.physical!.map,
    society = state.society!;
  let deaths = 0;
  for (const c of society.region.communities) {
    const cell = cellAt(state, c.position);
    if (cell < 0) continue;
    if (c.status === "inhabited") map.Tenure[cell] += population(c) * years;
    const fell = society.dieOff?.get(c.id) ?? 0;
    if (fell <= 0) continue;
    map.MassDeath[cell] += fell;
    deaths += fell;
  }
  society.dieOff?.clear();
  return deaths;
}
/** Each event's casualties, once, where the event struck. */
function recordEvents(state: GenerationState) {
  const map = state.physical!.map,
    society = state.society!,
    recorded = (society.deathsRecorded ??= new Set());
  let deaths = 0;
  for (const event of society.region.events) {
    if (recorded.has(event.id) || event.casualties <= 0) continue;
    recorded.add(event.id);
    const cell = cellAt(state, event.position);
    if (cell < 0) continue;
    map.MassDeath[cell] += event.casualties;
    deaths += event.casualties;
  }
  return deaths;
}
/** Every cell under a way takes the way's yearly travellers for the years of the cycle. */
function walkRoutes(state: GenerationState, years: number) {
  const map = state.physical!.map,
    region = state.society!.region,
    positions = new Map(region.communities.map((c) => [c.id, c.position]));
  for (const link of region.connections) {
    const wear = link.wear ?? 0,
      a = positions.get(link.from),
      b = positions.get(link.to);
    if (wear <= 0 || !a || !b) continue;
    for (const cell of cellsAlong(state, a, b, map.mesh.spacing / 2))
      map.WalkedRoute[cell] += wear * years;
  }
}
function cellsAlong(
  state: GenerationState,
  a: Pick<Position, "x" | "y">,
  b: Pick<Position, "x" | "y">,
  step: number
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, step))),
    cells = new Set<number>();
  for (let n = 0; n <= steps; n++) {
    const t = n / steps,
      cell = cellAt(state, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (cell >= 0) cells.add(cell);
  }
  return cells;
}

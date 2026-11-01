import { confluenceEffective, gridPosition, type MagicConfluence } from "@atlas/domain";
import { fractalNoise } from "../../canonry/noise";
import { matchesMagic } from "./conditions";
import { clamp, naturalChannel, neighbors, type RegionalState } from "../state";

/** A meeting can hold somewhere only if every system it reads passes its floor somewhere. */
export function meetingPossible(state: RegionalState, meeting: MagicConfluence) {
  return meeting.systems.every((id) => {
    const intensity = state.surface.channels[`magic:${id}:intensity`];
    if (!intensity) return false;
    for (let i = 0; i < intensity.length; i++)
      if (intensity.get(i) / 1000 > meeting.floor) return true;
    return false;
  });
}

export function meetingShare(state: RegionalState, meeting: MagicConfluence, i: number) {
  if (!matchesMagic(state, "", meeting.seeds, i)) return 0;
  const g = state.surface,
    values = meeting.systems.map((id) => g.channels[`magic:${id}:intensity`]?.get(i) ?? 0);
  const minimum = Math.min(...values) / 1000;
  if (minimum <= meeting.floor) return 0;
  let strain = 0;
  for (const j of neighbors(g, i))
    for (const id of meeting.systems) {
      const intensity = g.channels[`magic:${id}:intensity`];
      strain = Math.max(strain, Math.abs(intensity.get(i) - intensity.get(j)) / 1000);
    }
  return clamp(
    ((minimum - meeting.floor) / (1 - meeting.floor)) * (0.25 + strain * meeting.strainScale)
  );
}

/**
 * Meetings are processes with their own physical writes. Their totals are declared through
 * the contribution ledger so a round re-evaluates them against the present fields instead
 * of adding them again.
 */
export function meetingEffects(
  state: RegionalState,
  add: (channel: string, i: number, amount: number) => void
) {
  const world = state.domain.world,
    g = state.surface,
    c = g.channels,
    soil = naturalChannel(state, "soilDepth", "metre", 0.6);
  for (const meeting of world.confluences ?? []) {
    if (!confluenceEffective(meeting, world.magicSystems ?? [])) continue;
    if (!meetingPossible(state, meeting)) continue;
    for (let i = 0; i < g.active.length; i++) {
      const coverage = meetingShare(state, meeting, i);
      if (coverage) applyMeeting(state, meeting, i, coverage, soil, Boolean(c.ice), add);
    }
  }
}

/** One meeting's writes at one cell, scaled by its coverage there. */
function applyMeeting(
  state: RegionalState,
  meeting: MagicConfluence,
  i: number,
  coverage: number,
  soil: { get(i: number): number },
  ice: boolean,
  add: (channel: string, i: number, amount: number) => void
) {
  const g = state.surface,
    e = meeting.effects,
    p = gridPosition(g, i),
    detail = fractalNoise(p.x, p.y, state.input.seed ^ 0x6471, (g.scope.resolution ?? 1000) * 4, 2);
  add("fracture", i, (e.fractureConductance / 1000) * coverage);
  add("rock", i, (e.rockResistance / 4000) * coverage);
  add("soilDepth", i, -soil.get(i) * e.soilRemoval * coverage);
  add("elevation", i, e.relief * detail * coverage);
  if (ice) add("ice", i, -(e.iceMelt / 1000) * coverage);
  if (e.fog) add("fog", i, e.fog * coverage);
  add("sediment", i, e.debris * coverage);
}

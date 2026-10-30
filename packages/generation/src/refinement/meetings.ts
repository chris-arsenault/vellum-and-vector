import { confluenceEffective, gridPosition, type MagicConfluence } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { matchesMagic } from "./magicConditions";
import { clamp, neighbors, type RefinementState } from "./state";
import { routeRegionalWater } from "./water";
import { updateSlopes } from "./terrain";

export function meetingShare(state: RefinementState, meeting: MagicConfluence, i: number) {
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
export function applyRegionalMeetings(state: RefinementState) {
  const world = state.domain.world;
  let changed = false;
  for (const meeting of world.confluences ?? []) {
    if (!confluenceEffective(meeting, world.magicSystems ?? [])) continue;
    for (let i = 0; i < state.surface.active.length; i++) {
      const coverage = meetingShare(state, meeting, i);
      if (!coverage) continue;
      applyMeeting(state, meeting, i, coverage);
      changed ||= meeting.effects.relief > 0;
    }
  }
  if (changed) {
    updateSlopes(state);
    routeRegionalWater(state);
  }
}
function applyMeeting(
  state: RefinementState,
  meeting: MagicConfluence,
  i: number,
  coverage: number
) {
  const g = state.surface,
    c = g.channels,
    e = meeting.effects,
    p = gridPosition(g, i),
    detail = fractalNoise(p.x, p.y, state.input.seed ^ 0x6471, (g.scope.resolution ?? 1000) * 4, 2);
  c.fracture.set(i, clamp(c.fracture.get(i) + (e.fractureConductance / 1000) * coverage));
  c.rock.set(i, Math.max(0.01, c.rock.get(i) + (e.rockResistance / 4000) * coverage));
  c.soilDepth.set(i, c.soilDepth.get(i) * (1 - e.soilRemoval * coverage));
  c.elevation.add(i, e.relief * detail * coverage);
  if (c.ice) c.ice.set(i, Math.max(0, c.ice.get(i) - (e.iceMelt / 1000) * coverage));
  if (c.fog) c.fog.set(i, Math.max(c.fog.get(i), e.fog * coverage));
  c.sediment.add(i, e.debris * coverage);
}

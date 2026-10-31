import { gridPosition, point, type Band, type MagicSystem } from "@atlas/domain";
import {
  channel,
  distance,
  regionalComponents,
  resolvesRegionalComponent,
  type RefinementState,
} from "./state";
import { originSource, presentValue } from "./magicMaterials";
import { putRefinementFeature, putRefinementNetwork } from "./features";

/** Strong, spatially coherent tears can resolve local door ends; no past event is invented. */
export function developRegionalVeil(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    tear = originSource(state, system.id, "tear"),
    doors = originSource(state, system.id, "door"),
    source = channel(state, "magic:veil:source", "relative-intensity");
  for (let i = 0; i < intensity.length; i++) {
    tear.set(i, intensity.get(i));
    source.set(i, intensity.get(i));
    if (g.channels.water.get(i) !== 0) doors.set(i, 0);
  }
  const candidates = stableTears(state, system, intensity),
    used = new Set<number>();
  let count = 0;
  for (const a of candidates) {
    if (used.has(a) || count >= system.parameters.doorCount) continue;
    const b = doorPartner(state, system, intensity, candidates, used, a);
    if (b < 0) continue;
    publishDoorPair(state, intensity, a, b);
    doors.set(a, intensity.get(a));
    doors.set(b, intensity.get(b));
    used.add(a);
    used.add(b);
    count++;
  }
}
function stableTears(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    candidates: number[] = [];
  regionalComponents(
    g,
    (i) => doorEligible(state, system, intensity, i),
    (members) => {
      if (!resolvesRegionalComponent(g, members)) return;
      candidates.push(
        members.reduce((best, cell) => (intensity.get(cell) > intensity.get(best) ? cell : best))
      );
    }
  );
  return candidates.sort((a, b) => intensity.get(b) - intensity.get(a) || a - b);
}
function doorEligible(state: RefinementState, system: MagicSystem, intensity: Band, i: number) {
  return (
    state.surface.channels.water.get(i) === 0 &&
    intensity.get(i) >= system.parameters.doorStrain &&
    presentValue(state, "magic:veil:wild", i) < 0.1 &&
    presentValue(state, "magic:hallowed:intensity", i) < 500 &&
    presentValue(state, "magic:aurora:stored", i) < 300 &&
    presentValue(state, "magic:fire:source", i) === 0
  );
}
function doorPartner(
  state: RefinementState,
  system: MagicSystem,
  intensity: Band,
  candidates: number[],
  used: Set<number>,
  a: number
) {
  let partner = -1,
    gap = system.parameters.doorMatch + 1;
  for (const b of candidates) {
    if (b === a || used.has(b) || distance(state.surface, a, b) < system.parameters.doorDistance)
      continue;
    const difference = Math.abs(intensity.get(a) - intensity.get(b));
    if (difference < gap) {
      gap = difference;
      partner = b;
    }
  }
  return partner;
}
function publishDoorPair(state: RefinementState, intensity: Band, a: number, b: number) {
  const pa = gridPosition(state.surface, a),
    pb = gridPosition(state.surface, b),
    first = putRefinementFeature(state, `site:veil:door:${a}`, "veil:door", "magic", point(pa), {
      rule: "door",
      placeType: "Door",
      intensity: intensity.get(a),
    }),
    second = putRefinementFeature(state, `site:veil:door:${b}`, "veil:door", "magic", point(pb), {
      rule: "door",
      placeType: "Door",
      intensity: intensity.get(b),
      pairedDoor: first.id,
    });
  putRefinementFeature(state, `site:veil:door:${a}`, "veil:door", "magic", first.geometry, {
    ...first.attributes,
    pairedDoor: second.id,
  });
  putRefinementNetwork(state, first, 0, [
    [pa.x, pa.y, pa.z],
    [pb.x, pb.y, pb.z],
  ]);
}

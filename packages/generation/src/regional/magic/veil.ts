import { type Band, type MagicSystem } from "@atlas/domain";
import {
  channel,
  clamp,
  distance,
  neighbors,
  regionalComponents,
  resolvesRegionalComponent,
  type RegionalState,
} from "../state";
import { originSource, presentValue } from "./materials";

/**
 * Veil forms where other systems strain against each other and where a ward displaces them.
 * It is evaluated last in a round from the present fields; stable, coherent tears pair into
 * door ends. Door features and their network reach are published by the extraction.
 */
export function respondVeil(
  state: RegionalState,
  system: MagicSystem,
  intensity: Band,
  fields: Band[]
) {
  const g = state.surface,
    tear = originSource(state, system.id, "tear"),
    doors = originSource(state, system.id, "door"),
    source = channel(state, "magic:veil:source", "relative-intensity"),
    p = system.parameters;
  if (fields.length >= 2)
    for (let i = 0; i < g.active.length; i++) {
      const strain = localStrain(state, fields, i),
        held = clamp(presentValue(state, "magic:hallowed:intensity", i) / 1000),
        knitted = (strain / 1000) * (1 - p.knitVerdure * presentValue(state, "verdure", i)),
        strength = 1000 * clamp((knitted - p.tearFloor) / (p.tearFull - p.tearFloor));
      intensity.set(i, clamp(Math.max(intensity.get(i), strength) * (1 - held), 0, 1000));
    }
  for (let i = 0; i < intensity.length; i++) {
    tear.set(i, intensity.get(i));
    source.set(i, intensity.get(i));
    doors.set(i, 0);
  }
  pairDoors(state, system, intensity, doors);
}

function localStrain(state: RegionalState, fields: Band[], i: number) {
  let strain = 0;
  for (let a = 0; a < fields.length; a++)
    for (let b = a + 1; b < fields.length; b++) {
      const meeting = Math.min(fields[a].get(i), fields[b].get(i)) / 1000;
      for (const j of neighbors(state.surface, i))
        strain = Math.max(
          strain,
          meeting *
            Math.abs(fields[a].get(i) - fields[b].get(i) - (fields[a].get(j) - fields[b].get(j)))
        );
    }
  return strain;
}

/** Strong, spatially coherent tears resolve local door ends; no past event is invented. */
function pairDoors(state: RegionalState, system: MagicSystem, intensity: Band, doors: Band) {
  const candidates = stableTears(state, system, intensity),
    used = new Set<number>();
  let count = 0;
  for (const a of candidates) {
    if (used.has(a) || count >= system.parameters.doorCount) continue;
    const b = doorPartner(state, system, intensity, candidates, used, a);
    if (b < 0) continue;
    doors.set(a, intensity.get(a));
    doors.set(b, intensity.get(b));
    used.add(a);
    used.add(b);
    count++;
  }
}
function stableTears(state: RegionalState, system: MagicSystem, intensity: Band) {
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
function doorEligible(state: RegionalState, system: MagicSystem, intensity: Band, i: number) {
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
  state: RegionalState,
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

/** Door ends as pairs of cells, in the order they were paired; shared by the extraction. */
export function doorPairs(state: RegionalState, system: MagicSystem) {
  const doors = originSource(state, system.id, "door"),
    intensity = channel(state, "magic:veil:intensity", "relative-intensity"),
    ends: number[] = [];
  for (let i = 0; i < doors.length; i++) if (doors.get(i) > 0) ends.push(i);
  ends.sort((a, b) => intensity.get(b) - intensity.get(a) || a - b);
  const used = new Set<number>(),
    pairs: [number, number][] = [];
  for (const a of ends) {
    if (used.has(a)) continue;
    const b = doorPartner(state, system, intensity, ends, used, a);
    if (b < 0) continue;
    used.add(a);
    used.add(b);
    pairs.push([a, b]);
  }
  return pairs;
}

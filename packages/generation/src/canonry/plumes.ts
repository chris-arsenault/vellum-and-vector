// MantlePlumeRootLayer.cs: low-strain, separated roots sampled in world space.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { round } from "./math";
import { hashUnit } from "./noise";
import { nearestTriangle } from "./mesh";
import { worldCandidates, separatedCandidates } from "./worldSources";
import { areaBudget, mediumArea } from "./worldScale";

export function mantlePlumeRoots(map: PhysicalField, context: PhysicalContext) {
  map.MantlePlumeRootStrength.fill(0);
  const p = context.Profile;
  const count = areaBudget(p.MantlePlumeCount, mediumArea(map));
  const candidates = worldCandidates(map.mesh, context.Seed, Math.max(256, count * 256));
  const ranked = candidates
    .map((source) => {
      const cell = nearestTriangle(map.mesh, source.x, source.y);
      return { ...source, priority: 1000 - map.TectonicStrain.get(cell) + source.priority * 420 };
    })
    // hpc-exempt: seeded candidate objects that separatedCandidates consumes as records.
    .sort((a, b) => b.priority - a.priority);
  const selected = separatedCandidates(ranked, count, p.MantlePlumeMinimumSpacing, map.mesh);
  selected.forEach((source, rank) => {
    const position = selected.length <= 1 ? 0 : rank / (selected.length - 1);
    const floor = p.MantlePlumeMinimumShare / 1000;
    const falloff = (1 - position) ** (p.MantlePlumeStrengthExponent / 1000);
    const variation =
      (floor + (1 - floor) * falloff) *
      (0.88 + hashUnit(context.Seed ^ 0x54b1, source.id, 0) * 0.12);
    const strength = round(p.MantlePlumeStrength * variation);
    map.MantlePlumeRootStrength.set(nearestTriangle(map.mesh, source.x, source.y), strength);
    map.events.push({
      id: `plume:${context.Seed}:${source.id}`,
      kind: "plume",
      x: source.x,
      y: source.y,
      radius: p.MantlePlumeRadius,
      epoch: -1,
      strength,
    });
  });
}

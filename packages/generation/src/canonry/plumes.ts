// MantlePlumeRootLayer.cs: low-strain, separated roots sampled in world space.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { round } from "./math";
import { hashUnit } from "./noise";
import { nearestTriangle } from "./mesh";
import { worldCandidates, separatedCandidates, type WorldCandidate } from "./worldSources";
import { areaBudget, mediumArea } from "./worldScale";

/** The ocean plate over a cell, or 0. */
function oceanPlateAt(map: PhysicalField, cell: number) {
  return map.tectonics?.sites[map.CrustProvinceIds.get(cell) - 1]?.oceanPlate ?? 0;
}
/**
 * The mantle does not stop under open ocean: an ocean plate is wide and quiet enough that plumes
 * under it build island chains away from any boundary, so each has its share by area, and at least one.
 */
function oceanPlatePlumes(
  map: PhysicalField,
  profile: PhysicalContext["Profile"],
  ranked: WorldCandidate[]
) {
  const areas = new Map<number, number>();
  for (let i = 0; i < map.mesh.count; i++) {
    const plate = oceanPlateAt(map, i);
    if (plate) areas.set(plate, (areas.get(plate) ?? 0) + map.mesh.contentArea(i));
  }
  return [...areas].flatMap(([plate, area]) =>
    separatedCandidates(
      ranked.filter(
        (source) => oceanPlateAt(map, nearestTriangle(map.mesh, source.x, source.y)) === plate
      ),
      areaBudget(profile.MantlePlumeCount, area),
      profile.MantlePlumeMinimumSpacing,
      map.mesh
    )
  );
}
export function mantlePlumeRoots(map: PhysicalField, context: PhysicalContext) {
  map.MantlePlumeRootStrength.fill(0);
  const p = context.Profile;
  const worldCount = areaBudget(p.MantlePlumeCount, mediumArea(map));
  const candidates = worldCandidates(map.mesh, context.Seed, Math.max(256, worldCount * 256));
  const ranked = candidates
    .map((source) => {
      const cell = nearestTriangle(map.mesh, source.x, source.y);
      return { ...source, priority: 1000 - map.TectonicStrain.get(cell) + source.priority * 420 };
    })
    // hpc-exempt: seeded candidate objects that separatedCandidates consumes as records.
    .sort((a, b) => b.priority - a.priority);
  const oceanic = oceanPlatePlumes(map, p, ranked);
  const selected = separatedCandidates(
    [...oceanic, ...ranked],
    Math.max(worldCount, oceanic.length),
    p.MantlePlumeMinimumSpacing,
    map.mesh
  );
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

// MantlePlumeRootLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { round } from "./math";
import { hashUnit } from "./noise";
import { BoundedCandidates } from "./priorityQueue";
import { triangleDistanceSquared } from "./radial";
import { triangleIdentity } from "./mesh";

function separatedRoots(
  map: PhysicalField,
  context: PhysicalContext,
  candidates: number[],
  count: number
): number[] {
  const spacing = Math.min(
    context.Profile.MantlePlumeMinimumSpacing,
    Math.max(3, map.mesh.contentRadius * 1.4)
  );
  const selected: number[] = [];
  for (const candidate of candidates) {
    if (
      map.TectonicStrain[candidate] <= 420 &&
      selected.every(
        (root) => triangleDistanceSquared(map.mesh, root, candidate) >= spacing * spacing
      )
    ) {
      selected.push(candidate);
      if (selected.length === count) return selected;
    }
  }
  for (const candidate of candidates) {
    if (
      !selected.includes(candidate) &&
      selected.every(
        (root) => triangleDistanceSquared(map.mesh, root, candidate) >= spacing * spacing
      )
    ) {
      selected.push(candidate);
      if (selected.length === count) break;
    }
  }
  return selected;
}
export function mantlePlumeRoots(map: PhysicalField, context: PhysicalContext) {
  map.MantlePlumeRootStrength.fill(0);
  const p = context.Profile;
  if (p.MantlePlumeCount === 0) return;
  const count = Math.min(p.MantlePlumeCount, map.mesh.contentCount),
    candidates = new BoundedCandidates(Math.max(256, count * 256));
  for (let i = 0; i < map.mesh.contentCount; i++)
    candidates.consider(
      i,
      1000 - map.TectonicStrain[i] + hashUnit(context.Seed, triangleIdentity(map.mesh, i), 0) * 420
    );
  const selected = separatedRoots(map, context, candidates.bestIndexes(), count);
  selected.forEach((i, rank) => {
    const position = selected.length <= 1 ? 0 : rank / (selected.length - 1),
      floor = p.MantlePlumeMinimumShare / 1000;
    const falloff = (1 - position) ** (p.MantlePlumeStrengthExponent / 1000);
    const variation =
      (floor + (1 - floor) * falloff) * (0.88 + hashUnit(context.Seed ^ 0x54b1, rank, 0) * 0.12);
    map.MantlePlumeRootStrength[i] = round(p.MantlePlumeStrength * variation);
  });
}

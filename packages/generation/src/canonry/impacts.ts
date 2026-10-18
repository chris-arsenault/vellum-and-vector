// ImpactCrateringLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, rockResistance, round, truncate, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { BoundedCandidates } from "./priorityQueue";
import { triangleDistanceSquared } from "./radial";
import { deposit, rebuild } from "./surface";

function impactCount(map: PhysicalField, c: PhysicalContext): number {
  if (c.Profile.ImpactCraterCount === 0) return 0;
  const primordial = truncate(
    (c.Profile.ImpactCraterCount * c.Profile.ImpactPrimordialShare) / 1000
  );
  const share = truncate(
    (c.Profile.ImpactCraterCount - primordial) / Math.max(1, c.EpochCount - 1)
  );
  const configured = c.IsEvolutionEpoch
    ? Math.max(1, round(share * 0.6 ** c.EpochIndex))
    : primordial;
  return configured === 0
    ? 0
    : Math.min(configured, Math.max(1, truncate(map.mesh.contentCount / 3600)));
}
function centers(map: PhysicalField, c: PhysicalContext): number[] {
  const count = impactCount(map, c);
  if (count === 0) return [];
  const candidates = new BoundedCandidates(Math.max(256, count * 256));
  for (let i = 0; i < map.mesh.contentCount; i++)
    candidates.consider(
      i,
      hashUnit(c.Seed, round(map.mesh.x[i] * 256), round(map.mesh.y[i] * 256))
    );
  const ranked = candidates.bestIndexes(),
    selected: number[] = [];
  const spacing = Math.min(
    c.Profile.ImpactMinimumSpacing,
    Math.max(3, map.mesh.contentRadius * 0.72)
  );
  for (const i of ranked) {
    if (selected.every((j) => triangleDistanceSquared(map.mesh, i, j) >= spacing * spacing))
      selected.push(i);
    if (selected.length === count) return selected;
  }
  for (const i of ranked) {
    if (!selected.includes(i)) selected.push(i);
    if (selected.length === count) break;
  }
  return selected;
}
function excavate(
  map: PhysicalField,
  i: number,
  distance: number,
  radius: number,
  depth: number
): number {
  if (distance > radius) return 0;
  const requested = Math.max(1, units(depth * (1 - (distance / radius) ** 2)));
  const cut = Math.max(0, Math.min(requested, map.BedrockElevation[i] - units(-3800)));
  map.BedrockElevation[i] -= cut;
  map.SurfaceRockLoad[i] -= cut;
  map.ImpactExcavation[i] += cut;
  if (cut > 0) rebuild(map, i);
  return cut;
}
function raiseRim(map: PhysicalField, i: number, distance: number, radius: number, height: number) {
  const influence = 1 - Math.abs(distance / radius - 1) / 0.34;
  if (influence <= 0) return;
  const uplift = Math.max(
    0,
    Math.min(units(height * influence), units(3800) - map.BedrockElevation[i])
  );
  map.BedrockElevation[i] += uplift;
  map.SurfaceRockLoad[i] += uplift;
  map.ImpactRimUplift[i] += uplift;
  if (uplift > 0) rebuild(map, i);
}
function shock(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  distance: number,
  radius: number,
  share: number
) {
  const influence = 1 - distance / (radius * 1.45);
  if (influence > 0)
    map.FractureConductance[i] = Math.max(
      map.FractureConductance[i],
      round(p.ImpactFractureStrength * influence)
    );
  if (radius >= p.ImpactThermalRadiusThreshold && distance <= radius)
    map.ImpactHeat[i] = Math.max(map.ImpactHeat[i], round(1000 * (1 - distance / radius)));
  if (distance > radius * 1.15 || share <= 0) return;
  const gain = 1600 * (1 - distance / Math.max(0.001, radius * 1.15)) * share;
  map.RockResistance[i] = Math.max(map.RockResistance[i], rockResistance(1000 + round(gain)));
}
function ejecta(
  map: PhysicalField,
  p: PhysicalProfile,
  candidates: [number, number][],
  excavation: number
): number {
  let remaining = truncate((excavation * p.ImpactEjectaFraction) / 1000),
    deposited = 0;
  let totalWeight = candidates.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [i, weight] of candidates) {
    if (remaining <= 0 || totalWeight <= 0) break;
    const headroom = Math.max(0, units(3800) - map.Elevation[i]);
    const requested = Math.min(headroom, Math.max(1, truncate((remaining * weight) / totalWeight)));
    totalWeight -= weight;
    if (requested <= 0) continue;
    const amount = deposit(map, i, requested);
    map.ImpactEjectaThickness[i] += amount;
    remaining -= amount;
    deposited += amount;
  }
  return deposited;
}
function applyImpact(map: PhysicalField, p: PhysicalProfile, center: number, radius: number) {
  map.FeatureFlags[center] |= Feature.ImpactCenter;
  const scale = radius / Math.max(radius, p.ImpactMaximumRadius);
  const depth = Math.max(1, round(((p.ElevationScale * p.ImpactDepthRatio) / 1000) * scale));
  const rim = Math.max(1, round(((p.ElevationScale * p.ImpactRimHeightRatio) / 1000) * scale));
  const share = 1 - clamp(map.WaterDepths[center] / units(p.ImpactOceanShockDepth), 0, 1);
  let excavation = 0;
  const candidates: [number, number][] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = Math.sqrt(triangleDistanceSquared(map.mesh, center, i));
    excavation += excavate(map, i, distance, radius, depth);
    raiseRim(map, i, distance, radius, rim);
    shock(map, p, i, distance, radius, share);
    if (distance >= radius && distance <= radius * 2.2)
      candidates.push([i, Math.max(1, round(1000 * (1 - (distance - radius) / (radius * 1.2))))]);
  }
  map.SedimentProducedTotal += excavation;
  map.SedimentExportedTotal += excavation - ejecta(map, p, candidates, excavation);
}
export function impactCratering(map: PhysicalField, c: PhysicalContext) {
  if (c.IsEvolutionEpoch && c.EpochIndex >= c.EpochCount - 1) return;
  centers(map, c).forEach((center, index) => {
    const maximum = Math.min(
      c.Profile.ImpactMaximumRadius,
      Math.max(2, map.mesh.contentRadius * 0.24)
    );
    const minimum = Math.min(c.Profile.ImpactMinimumRadius, maximum * 0.72);
    applyImpact(
      map,
      c.Profile,
      center,
      minimum + (maximum - minimum) * hashUnit(c.Seed ^ 0x3a91, index, 0)
    );
  });
}

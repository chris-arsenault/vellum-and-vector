// ImpactCrateringLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, rockResistance, round, truncate, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { nearestTriangle } from "./mesh";
import { worldCandidates, separatedCandidates, type WorldCandidate } from "./worldSources";
import { deposit, rebuild } from "./surface";
import { areaBudget, mediumArea } from "./worldScale";

function impactCount(c: PhysicalContext): number {
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
  return configured;
}
function centers(map: PhysicalField, c: PhysicalContext): WorldCandidate[] {
  const count = areaBudget(impactCount(c), mediumArea(map));
  if (count === 0) return [];
  const ranked = worldCandidates(map.mesh, c.Seed, Math.max(256, count * 256)).sort(
    (a, b) => b.priority - a.priority
  );
  return separatedCandidates(ranked, count, c.Profile.ImpactMinimumSpacing);
}
export function plannedImpacts(map: PhysicalField, c: PhysicalContext) {
  if (c.IsEvolutionEpoch && c.EpochIndex >= c.EpochCount - 1) return [];
  return centers(map, c).map((center) => ({
    ...center,
    radius:
      c.Profile.ImpactMinimumRadius +
      (c.Profile.ImpactMaximumRadius - c.Profile.ImpactMinimumRadius) *
        hashUnit(c.Seed ^ 0x3a91, center.id, 0),
  }));
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
    const requested = Math.min(
      headroom,
      (((remaining * weight) / totalWeight) * 1024) / map.mesh.areas[i]
    );
    totalWeight -= weight;
    if (requested <= 0) continue;
    const amount = deposit(map, i, requested);
    map.ImpactEjectaThickness[i] += amount;
    const volume = (amount / 1024) * map.mesh.areas[i];
    remaining -= volume;
    deposited += volume;
  }
  return deposited;
}
function applyImpact(
  map: PhysicalField,
  p: PhysicalProfile,
  source: WorldCandidate,
  radius: number
) {
  const center = nearestTriangle(map.mesh, source.x, source.y);
  map.FeatureFlags[center] |= Feature.ImpactCenter;
  const scale = (radius / Math.max(radius, p.ImpactMaximumRadius)) ** 0.3;
  const depth = Math.max(1, round(((p.ElevationScale * p.ImpactDepthRatio) / 1000) * scale));
  const rim = Math.max(1, round(((p.ElevationScale * p.ImpactRimHeightRatio) / 1000) * scale));
  const share = 1 - clamp(map.WaterDepths[center] / units(p.ImpactOceanShockDepth), 0, 1);
  let excavation = 0;
  const candidates: [number, number][] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = Math.hypot(map.mesh.x[i] - source.x, map.mesh.y[i] - source.y);
    excavation += (excavate(map, i, distance, radius, depth) / 1024) * map.mesh.areas[i];
    raiseRim(map, i, distance, radius, rim);
    shock(map, p, i, distance, radius, share);
    if (distance >= radius && distance <= radius * 2.2)
      candidates.push([
        i,
        map.mesh.areas[i] * Math.max(0, 1 - (distance - radius) / (radius * 1.2)),
      ]);
  }
  map.SedimentProducedTotal += excavation;
  map.SedimentExportedTotal += excavation - ejecta(map, p, candidates, excavation);
}
export function impactCratering(map: PhysicalField, c: PhysicalContext) {
  plannedImpacts(map, c).forEach((center) => {
    const radius = center.radius;
    map.events.push({
      id: `impact:${c.Seed}:${center.id}`,
      kind: "impact",
      x: center.x,
      y: center.y,
      radius,
      epoch: c.IsEvolutionEpoch ? c.EpochIndex : -1,
      strength: 1000,
    });
    applyImpact(map, c.Profile, center, radius);
  });
}

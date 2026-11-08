import { meshDeltaX } from "./mesh";
import { MapScale } from "@atlas/domain";
// ImpactCrateringLayer.cs, Canonry 0f62584c.
import { rockCatalogue } from "../rock/rockCatalogue";
import { hardenRock } from "../rock/rockField";
import { crustForming, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, truncate, units } from "./math";
import { hashUnit } from "./noise";
import { Feature } from "./codes";
import { nearestTriangle } from "./mesh";
import { worldCandidates, separatedCandidates, type WorldCandidate } from "./worldSources";
import { deposit, displaceGround, excavateRock } from "../rock/groundLedger";
import { areaBudget, mediumArea } from "./worldScale";

function impactCount(map: PhysicalField, c: PhysicalContext): number {
  if (c.Profile.ImpactCraterCount === 0) return 0;
  const primordial = truncate(
    (c.Profile.ImpactCraterCount * c.Profile.ImpactPrimordialShare) / 1000
  );
  if (crustForming(map)) return primordial;
  // What falls after the first forming falls evenly through time, however long each epoch lasts.
  const share = (c.Profile.ImpactCraterCount - primordial) / Math.max(1, c.EpochCount);
  return Math.max(1, round(share * c.Span));
}
function centers(map: PhysicalField, c: PhysicalContext): WorldCandidate[] {
  const count = areaBudget(impactCount(map, c), mediumArea(map), map.scale.area(0.75));
  if (count === 0) return [];
  const ranked = worldCandidates(map.mesh, c.Seed, Math.max(256, count * 256)).sort(
    (a, b) => b.priority - a.priority
  );
  return separatedCandidates(ranked, count, c.Profile.ImpactMinimumSpacing, map.mesh);
}
export function plannedImpacts(map: PhysicalField, c: PhysicalContext) {
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
  const excavated = excavateRock(map, i, requested, "impacts", "space");
  map.ImpactExcavation.add(i, excavated);
  return excavated;
}
function raiseRim(map: PhysicalField, i: number, distance: number, radius: number, height: number) {
  const influence = 1 - Math.abs(distance / radius - 1) / 0.34;
  if (influence <= 0) return;
  const uplift = Math.max(0, units(height * influence));
  displaceGround(map, i, uplift, "impacts");
  map.ImpactRimUplift.add(i, uplift);
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
    map.FractureConductance.set(
      i,
      Math.max(map.FractureConductance.get(i), round(p.ImpactFractureStrength * influence))
    );
  if (radius >= p.ImpactThermalRadiusThreshold && distance <= radius)
    map.ImpactHeat.set(i, Math.max(map.ImpactHeat.get(i), round(1000 * (1 - distance / radius))));
  if (distance > radius * 1.15 || share <= 0) return;
  const gain = 1600 * (1 - distance / Math.max(0.001, radius * 1.15)) * share;
  hardenRock(map, i, "impactite", rockCatalogue.strata.resistance + round(gain));
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
    const area = map.mesh.area(i),
      requested = MapScale.inUnits((remaining * weight) / totalWeight / area, "native");
    totalWeight -= weight;
    if (requested <= 0) continue;
    const amount = deposit(map, i, requested, "impacts", "space");
    map.ImpactEjectaThickness.add(i, amount);
    const volume = MapScale.metres(amount, "native") * area;
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
  const scale = (radius / Math.max(radius, p.ImpactMaximumRadius)) ** 0.3;
  const depth = Math.max(1, round(((p.ElevationScale * p.ImpactDepthRatio) / 1000) * scale));
  const rim = Math.max(1, round(((p.ElevationScale * p.ImpactRimHeightRatio) / 1000) * scale));
  shapeImpact(map, p, source, radius, depth, rim);
}
/** Excavate, raise the rim, shock the rock and spread ejecta for a crater of the given measures (metres). */
export function shapeImpact(
  map: PhysicalField,
  p: PhysicalProfile,
  source: { x: number; y: number },
  radius: number,
  depth: number,
  rim: number
) {
  const center = nearestTriangle(map.mesh, source.x, source.y);
  map.FeatureFlags.set(center, map.FeatureFlags.get(center) | Feature.ImpactCenter);
  const share = 1 - clamp(map.WaterDepths.get(center) / units(p.ImpactOceanShockDepth), 0, 1);
  let excavation = 0;
  const candidates: [number, number][] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = Math.hypot(
        meshDeltaX(map.mesh, map.mesh.x(i) - source.x),
        map.mesh.y(i) - source.y
      ),
      area = map.mesh.area(i);
    excavation += MapScale.metres(excavate(map, i, distance, radius, depth), "native") * area;
    raiseRim(map, i, distance, radius, rim);
    shock(map, p, i, distance, radius, share);
    if (distance >= radius && distance <= radius * 2.2)
      candidates.push([i, area * Math.max(0, 1 - (distance - radius) / (radius * 1.2))]);
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
      epoch: crustForming(map) ? -1 : c.EpochIndex,
      strength: 1000,
    });
    applyImpact(map, c.Profile, center, radius);
  });
}

// TectonicProvinceLayer assignment and boundary stress, Canonry 0f62584c.
import type { PhysicalContext } from "./context";
import type { PhysicalField } from "./field";
import { clamp, round } from "./math";
import { meshNoise as fractalNoise } from "./noise";
import { createProvinceSites, type ProvinceSite } from "./provinceSites";
import { meshDeltaX, type PhysicalMesh } from "./mesh";

interface Selection {
  nearest: number;
  second: number;
  nearestDistance: number;
  secondDistance: number;
  nearestContinental: number;
  continentalDistance: number;
  oceanicDistance: number;
}
const unit = (value: number) => round(clamp(value, 0, 1) * 1000);
const motion = (value: number) => round(clamp(value, -1, 1) * 1000);
function selectSites(sites: ProvinceSite[], x: number, y: number, mesh: PhysicalMesh): Selection {
  const result: Selection = {
    nearest: -1,
    second: -1,
    nearestDistance: Infinity,
    secondDistance: Infinity,
    nearestContinental: -1,
    continentalDistance: Infinity,
    oceanicDistance: Infinity,
  };
  for (const [i, site] of sites.entries()) {
    const distance = Math.hypot(meshDeltaX(mesh, x - site.x), y - site.y);
    if (site.assembly > 0 && distance < result.continentalDistance) {
      result.nearestContinental = i;
      result.continentalDistance = distance;
    } else if (site.assembly === 0)
      result.oceanicDistance = Math.min(result.oceanicDistance, distance);
    if (distance < result.nearestDistance) {
      result.second = result.nearest;
      result.secondDistance = result.nearestDistance;
      result.nearest = i;
      result.nearestDistance = distance;
    } else if (distance < result.secondDistance) {
      result.second = i;
      result.secondDistance = distance;
    }
  }
  return result;
}
function relativeMotion(sites: ProvinceSite[], selection: Selection, mesh: PhysicalMesh): number {
  if (selection.second < 0) return 0;
  const a = sites[selection.nearest],
    b = sites[selection.second];
  const dx = meshDeltaX(mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  return ((b.motionX - a.motionX) * dx) / length + ((b.motionY - a.motionY) * dy) / length;
}
function boundaryDistance(sites: ProvinceSite[], s: Selection, mesh: PhysicalMesh): number {
  if (s.second < 0) return Infinity;
  const a = sites[s.nearest],
    b = sites[s.second];
  const separation = Math.hypot(meshDeltaX(mesh, b.x - a.x), b.y - a.y);
  // Perpendicular distance to the bisector in the existing warped coordinate frame.
  // A distance difference alone saturates at the site separation and makes close
  // pairs appear active arbitrarily far from their shared boundary.
  return (s.secondDistance ** 2 - s.nearestDistance ** 2) / (2 * separation);
}
function assemblyGap(
  sites: ProvinceSite[],
  s: Selection,
  context: PhysicalContext,
  mesh: PhysicalMesh
): number {
  if (s.second < 0) return 0;
  const a = sites[s.nearest].assembly,
    b = sites[s.second].assembly;
  if (a === 0 || b === 0 || a === b) return 0;
  const p = context.Profile;
  // Only divergence opens a continental rift. Transform contacts preserve crust.
  if (relativeMotion(sites, s, mesh) <= p.TectonicConvergenceThreshold) return 0;
  const raw =
    clamp(1 - boundaryDistance(sites, s, mesh) / Math.max(0.001, p.RidgeWidth * 1.4), 0, 1) *
    p.ContinentalAssemblySeparationDepth;
  return raw;
}
function assignBoundary(
  map: PhysicalField,
  i: number,
  sites: ProvinceSite[],
  s: Selection,
  context: PhysicalContext
) {
  const p = context.Profile;
  const amount = clamp(
    1 - boundaryDistance(sites, s, map.mesh) / Math.max(0.001, p.RidgeWidth * 0.9),
    0,
    1
  );
  if (amount <= 0) {
    for (const name of [
      "TectonicBoundaryCodes",
      "TectonicStrain",
      "TectonicBoundaryPairIds",
      "TectonicTangentX",
      "TectonicTangentY",
    ] as const)
      map[name][i] = 0;
    return;
  }
  const relative = relativeMotion(sites, s, map.mesh);
  map.TectonicBoundaryCodes[i] =
    relative < -p.TectonicConvergenceThreshold
      ? 1
      : relative > p.TectonicConvergenceThreshold
        ? 2
        : 3;
  map.TectonicBoundaryPairIds[i] =
    ((Math.min(s.nearest, s.second) + 1) << 16) | (Math.max(s.nearest, s.second) + 1);
  map.TectonicStrain[i] = unit(amount * clamp(0.48 + Math.abs(relative), 0, 1));
  const a = sites[s.nearest],
    b = sites[s.second],
    dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y;
  const length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  let tx = -dy / length,
    ty = dx / length;
  if (tx < 0 || (Math.abs(tx) < 0.000001 && ty < 0)) {
    tx = -tx;
    ty = -ty;
  }
  map.TectonicTangentX[i] = motion(tx);
  map.TectonicTangentY[i] = motion(ty);
}
function initialAssembly(
  sites: ProvinceSite[],
  s: Selection,
  site: ProvinceSite,
  composition: number,
  rifted: boolean
) {
  if (rifted || composition <= 0) return 0;
  return site.assembly > 0 ? site.assembly : sites[s.nearestContinental].assembly;
}
function assignTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  sites: ProvinceSite[],
  i: number
) {
  const p = context.Profile,
    x = map.mesh.x[i],
    y = map.mesh.y[i];
  const wx =
    fractalNoise(map.mesh, x, y, context.Seed ^ 0x16f1, p.ContinentalWarpScale, 3) *
    p.ContinentalWarpStrength;
  const wy =
    fractalNoise(map.mesh, x, y, context.Seed ^ 0x62bd, p.ContinentalWarpScale, 3) *
    p.ContinentalWarpStrength;
  const s = selectSites(sites, x + wx, y + wy, map.mesh),
    site = sites[s.nearest];
  map.CrustProvinceIds[i] = s.nearest + 1;
  map.CrustMotionX[i] = motion(site.motionX);
  map.CrustMotionY[i] = motion(site.motionY);
  const affinity = clamp(
    0.5 + (s.oceanicDistance - s.continentalDistance) / (p.ContinentalTransitionWidth * 2),
    0,
    1
  );
  let potential =
    site.assembly > 0
      ? Math.max(affinity, p.ContinentalCrustPotentialFloor)
      : Math.min(affinity, p.OceanicCrustPotentialCeiling);
  const gap = assemblyGap(sites, s, context, map.mesh);
  let composition = clamp(affinity - gap, 0, 1);
  potential -= gap;
  if (site.assembly > 0 && gap > 0)
    potential = Math.min(potential, p.ContinentalCrustPotentialFloor - gap);
  const rifted = site.assembly > 0 && gap > 0 && gap >= p.ContinentalAssemblySeparationDepth * 0.12;
  if (!context.IsEvolutionEpoch)
    map.CrustAssemblyIds[i] = initialAssembly(sites, s, site, composition, rifted);
  if (rifted) {
    potential = Math.min(potential, p.OceanicCrustPotentialCeiling - gap);
    composition = Math.min(composition, p.OceanicCrustPotentialCeiling - gap);
  }
  map.CrustAssemblySeparation[i] = unit(gap);
  map.CrustBasePotential[i] = unit(potential);
  if (!context.IsEvolutionEpoch) map.CrustContinentalFraction[i] = unit(composition);
  map.CrustTypeCodes[i] = map.CrustContinentalFraction[i] >= 500 ? 2 : 1;
  assignBoundary(map, i, sites, s, context);
}
export function tectonicProvinces(map: PhysicalField, context: PhysicalContext) {
  const sites = createProvinceSites(map, context);
  for (let i = 0; i < map.mesh.count; i++) assignTriangle(map, context, sites, i);
  map.InitialTectonicBoundaryCodes.set(map.TectonicBoundaryCodes);
  map.InitialTectonicStrain.set(map.TectonicStrain);
}
export function continentalDomains(map: PhysicalField, context: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const potential = map.CrustBasePotential[i] / 1000;
    const roughness = fractalNoise(
      map.mesh,
      map.mesh.x[i],
      map.mesh.y[i],
      context.Seed ^ 0x41c7,
      context.Profile.ContinentalWarpScale * 0.44,
      4
    );
    const margin = 1 - clamp(Math.abs(potential - 0.5) * 2, 0, 1);
    const strain = map.TectonicStrain[i] / 1000;
    const adjustment =
      map.TectonicBoundaryCodes[i] === 1
        ? strain * 0.07
        : map.TectonicBoundaryCodes[i] === 2
          ? strain * -0.12
          : 0;
    const value = clamp(
      potential + roughness * (0.025 + margin * margin * 0.14) + adjustment,
      0,
      1
    );
    map.ContinentalPotential[i] = unit(value * value * (3 - 2 * value));
  }
}

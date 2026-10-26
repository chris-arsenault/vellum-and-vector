// TectonicProvinceLayer assignment and boundary stress, Canonry 0f62584c.
import type { PhysicalContext } from "./context";
import type { PhysicalField } from "./field";
import { clamp, round } from "./math";
import { meshNoise as fractalNoise } from "./noise";
import type { ProvinceSite } from "./provinceSites";
import { tectonicSites, tectonicBond } from "./tectonicState";
import { tectonicRiftActivation } from "./tectonicControls";
import { meshDeltaX, type PhysicalMesh } from "./mesh";
import { siteMotion } from "./tectonicMotion";

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
function boundarySelection(map: PhysicalField, selection: Selection, x: number, y: number) {
  const state = map.tectonics!,
    nearest = state.sites[selection.nearest];
  selection.second = -1;
  selection.secondDistance = Infinity;
  for (let i = 0; i < state.sites.length; i++) {
    if (i === selection.nearest) continue;
    const site = state.sites[i],
      bond = tectonicBond(state, selection.nearest, i);
    const loading = bond?.active && bond.extension - bond.shortening >= tectonicRiftActivation;
    if (site.plate === nearest.plate && !loading) continue;
    const distance = Math.hypot(meshDeltaX(map.mesh, x - site.x), y - site.y);
    if (distance < selection.secondDistance) {
      selection.second = i;
      selection.secondDistance = distance;
    }
  }
}
function clearBoundary(map: PhysicalField, i: number) {
  for (const name of [
    "TectonicBoundaryCodes",
    "TectonicStrain",
    "TectonicBoundaryPairIds",
    "TectonicTangentX",
    "TectonicTangentY",
  ] as const)
    map[name][i] = 0;
}
function boundaryCode(relative: number, extension: number, threshold: number) {
  if (relative < -threshold) return 1;
  if (relative > threshold) return 2;
  if (relative > 0 && extension >= tectonicRiftActivation) return 2;
  return 3;
}
function bondExtension(map: PhysicalField, s: Selection) {
  const bond = tectonicBond(map.tectonics!, s.nearest, s.second);
  if (!bond) return 0;
  return Math.max(0, bond.extension - bond.shortening);
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
    clearBoundary(map, i);
    return;
  }
  const relative = relativeMotion(sites, s, map.mesh);
  const a = sites[s.nearest],
    b = sites[s.second];
  const speed = Math.hypot(b.motionX - a.motionX, b.motionY - a.motionY);
  if (speed < 1e-6) {
    clearBoundary(map, i);
    return;
  }
  const extension = bondExtension(map, s);
  map.TectonicBoundaryCodes[i] = boundaryCode(relative, extension, p.TectonicConvergenceThreshold);
  map.TectonicBoundaryPairIds[i] =
    ((Math.min(s.nearest, s.second) + 1) << 16) | (Math.max(s.nearest, s.second) + 1);
  map.TectonicStrain[i] = unit(amount * clamp(speed + extension, 0, 1));
  map.CrustRiftStrain[i] = Math.max(map.CrustRiftStrain[i], extension * amount);
  const dx = meshDeltaX(map.mesh, b.x - a.x),
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
  composition: number
) {
  if (composition <= 0) return 0;
  return site.assembly > 0 ? site.assembly : sites[s.nearestContinental].assembly;
}
function assignMotion(map: PhysicalField, i: number, nearest: number) {
  const state = map.tectonics!,
    site = state.sites[nearest],
    plate = state.plates.find((plate) => plate.id === site.plate)!;
  const [vx, vy] = siteMotion(map, { x: map.mesh.x[i], y: map.mesh.y[i] }, plate);
  map.CrustMotionX[i] = motion(vx + site.compliance * (site.driveX - vx));
  map.CrustMotionY[i] = motion(vy + site.compliance * (site.driveY - vy));
}
function assignTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  sites: ProvinceSite[],
  i: number
) {
  const p = context.Profile,
    x = map.mesh.x[i],
    y = map.mesh.y[i],
    seed = map.tectonics!.seed;
  const wx =
    fractalNoise(map.mesh, x, y, seed ^ 0x16f1, p.ContinentalWarpScale, 3) *
    p.ContinentalWarpStrength;
  const wy =
    fractalNoise(map.mesh, x, y, seed ^ 0x62bd, p.ContinentalWarpScale, 3) *
    p.ContinentalWarpStrength;
  const s = selectSites(sites, x + wx, y + wy, map.mesh),
    site = sites[s.nearest];
  boundarySelection(map, s, x + wx, y + wy);
  map.CrustProvinceIds[i] = s.nearest + 1;
  map.CrustPlateIds[i] = map.tectonics!.sites[s.nearest].plate;
  assignMotion(map, i, s.nearest);
  const affinity = clamp(
    0.5 + (s.oceanicDistance - s.continentalDistance) / (p.ContinentalTransitionWidth * 2),
    0,
    1
  );
  const potential =
    site.assembly > 0
      ? Math.max(affinity, p.ContinentalCrustPotentialFloor)
      : Math.min(affinity, p.OceanicCrustPotentialCeiling);
  if (!context.IsEvolutionEpoch)
    map.CrustAssemblyIds[i] = initialAssembly(sites, s, site, affinity);
  map.CrustAssemblySeparation[i] = unit(
    clamp(map.CrustRiftStrain[i], 0, 1) * p.ContinentalAssemblySeparationDepth
  );
  map.CrustBasePotential[i] = unit(potential);
  if (!context.IsEvolutionEpoch) map.CrustContinentalFraction[i] = unit(affinity);
  map.CrustTypeCodes[i] = map.CrustContinentalFraction[i] >= 500 ? 2 : 1;
  assignBoundary(map, i, sites, s, context);
}
export function tectonicProvinces(map: PhysicalField, context: PhysicalContext) {
  const sites = tectonicSites(map, context);
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

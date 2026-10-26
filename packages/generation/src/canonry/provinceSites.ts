// TectonicProvinceLayer.CreateSites and continental assembly growth, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { lerp } from "./math";
import { hashUnit } from "./noise";
import { worldCandidates } from "./worldSources";
import { provinceTerritories, type ProvinceTerritories } from "./provinceTerritories";

interface Candidate {
  x: number;
  y: number;
  priority: number;
}
export interface ProvinceSite extends Candidate {
  assembly: number;
  motionX: number;
  motionY: number;
}
interface RegionGrowth {
  root: Candidate;
  index: number;
  count: number;
  cohesion: number;
  adjacent: Uint8Array;
}
const deltaX = (dx: number, width = 0) => (width ? dx - Math.round(dx / width) * width : dx);
const distance2 = (a: Candidate, b: Candidate, width = 0) =>
  deltaX(a.x - b.x, width) ** 2 + (a.y - b.y) ** 2;
const radius2 = (a: Candidate) => a.x * a.x + a.y * a.y;
function bestIndex(indices: number[], score: (index: number) => number): number {
  let best = indices[0],
    maximum = -Infinity;
  for (const i of indices) {
    const value = score(i);
    if (value > maximum) {
      best = i;
      maximum = value;
    }
  }
  return best;
}
function minimumDistance(
  sites: Candidate[],
  candidate: number,
  selected: number[],
  width = 0
): number {
  return selected.reduce(
    (minimum, i) => Math.min(minimum, distance2(sites[candidate], sites[i], width)),
    Infinity
  );
}
function anchors(
  sites: Candidate[],
  count: number,
  territory: ProvinceTerritories,
  target: number,
  width: number,
  clustering: number,
  provinceArea: number
): number[] {
  const indices = sites.map((_, i) => i);
  const { areas } = territory;
  // Seed each requested assembly without spending its whole area budget on a large block.
  const smaller = indices.filter((i) => areas[i] <= target / count);
  const candidates = smaller.length >= count ? smaller : indices;
  const chosen = [
    bestIndex(candidates, (i) => -radius2(sites[i]) / (0.8 + sites[i].priority * 0.4)),
  ];
  const regions = Math.ceil(Math.sqrt(count));
  const labels = new Int32Array(sites.length);
  labels[chosen[0]] = 1;
  while (chosen.length < count) {
    const options = oceanSeparated(
      candidates.filter((i) => !chosen.includes(i)),
      labels,
      chosen.length % regions,
      regions,
      clustering,
      territory.adjacent
    );
    const next = bestIndex(options, (i) =>
      anchorScore(sites, i, chosen, regions, width, clustering, provinceArea)
    );
    chosen.push(next);
    labels[next] = chosen.length;
  }
  return chosen;
}
function anchorScore(
  sites: Candidate[],
  i: number,
  chosen: number[],
  regions: number,
  width: number,
  clustering: number,
  provinceArea: number
) {
  const separation = minimumDistance(sites, i, chosen, width);
  if (chosen.length < regions || clustering === 0) return separation;
  // Neighboring assemblies retain separate identities and motion while growing into
  // compound continental regions. Only the region roots maximize global separation.
  const parent = chosen[(chosen.length - regions) % regions];
  return (
    separation * Math.exp((-clustering * distance2(sites[i], sites[parent], width)) / provinceArea)
  );
}
function assemblyDistance(
  sites: Candidate[],
  selected: Int32Array,
  candidate: number,
  assembly: number,
  competing = false,
  width = 0
): number {
  const indices = sites
    .map((_, i) => i)
    .filter((i) =>
      competing ? selected[i] !== 0 && selected[i] !== assembly : selected[i] === assembly
    );
  return minimumDistance(sites, candidate, indices, width);
}
function frontierSite(
  sites: Candidate[],
  selected: Int32Array,
  assembly: number,
  anchor: number,
  direction: [number, number],
  width: number,
  region: RegionGrowth
): number {
  let best = -1,
    bestCost = Infinity;
  const remaining = sites.map((_, i) => i).filter((i) => selected[i] === 0);
  const candidates = oceanSeparated(
    remaining,
    selected,
    region.index,
    region.count,
    region.cohesion,
    region.adjacent
  );
  for (const candidate of candidates) {
    const frontier = assemblyDistance(sites, selected, candidate, assembly, false, width);
    if (assemblyDistance(sites, selected, candidate, assembly, true, width) < frontier * 0.62)
      continue;
    const dx = deltaX(sites[candidate].x - sites[anchor].x, width),
      dy = sites[candidate].y - sites[anchor].y;
    const length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    const alignment = Math.abs((dx / length) * direction[0] + (dy / length) * direction[1]);
    const distance = Math.sqrt(frontier);
    const regionalDistance = Math.sqrt(distance2(sites[candidate], region.root, width));
    const cost =
      distance * (1.12 - alignment * 0.48) -
      sites[candidate].priority * distance * 0.1 +
      region.cohesion * regionalDistance;
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  if (best >= 0) return best;
  return candidates.length
    ? bestIndex(candidates, (i) => -assemblyDistance(sites, selected, i, assembly, false, width))
    : -1;
}
function oceanSeparated(
  candidates: number[],
  selected: Int32Array,
  region: number,
  regionCount: number,
  clustering: number,
  adjacent: Uint8Array
): number[] {
  if (clustering === 0) return candidates;
  // Keep oceanic provinces between continental regions when the crust budget leaves room.
  // Nearby seed points alone do not describe the extent of irregular province territories.
  const separated = candidates.filter((i) =>
    selected.every(
      (assembly, j) =>
        assembly === 0 ||
        (assembly - 1) % regionCount === region ||
        !adjacent[i * selected.length + j]
    )
  );
  return separated.length ? separated : candidates;
}
function growthRegions(
  sites: Candidate[],
  chosen: number[],
  cohesion: number,
  adjacent: Uint8Array
): RegionGrowth[] {
  const roots = chosen.slice(0, Math.ceil(Math.sqrt(chosen.length))).map((i) => sites[i]);
  return roots.map((root, index) => ({ root, index, count: roots.length, cohesion, adjacent }));
}
function assemblies(
  sites: Candidate[],
  territory: ProvinceTerritories,
  context: PhysicalContext,
  width: number,
  provinceArea: number
): Int32Array {
  const profile = context.Profile,
    seed = context.EpochStableSeed;
  const { areas } = territory;
  const target = areas.reduce((sum, area) => sum + area, 0) * profile.ContinentalCrustFraction;
  const result = new Int32Array(sites.length),
    chosen = anchors(
      sites,
      profile.ContinentalAssemblyCount,
      territory,
      target,
      width,
      profile.ContinentalAssemblyClustering,
      provinceArea
    );
  chosen.forEach((i, n) => {
    result[i] = n + 1;
  });
  const regions = growthRegions(
    sites,
    chosen,
    profile.ContinentalAssemblyClustering,
    territory.adjacent
  );
  const directions = chosen.map((_, i): [number, number] => {
    const angle = hashUnit(seed ^ 0x67d3, i, 0) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const weights = chosen.map(
    (_, i) =>
      1 + (hashUnit(seed ^ 0x4b19, i, 0) * 2 - 1) * profile.ContinentalAssemblyGrowthVariation
  );
  const weight = weights.reduce((sum, value) => sum + value, 0);
  const occupied = Float64Array.from(chosen, (i) => areas[i]);
  let total = occupied.reduce((sum, area) => sum + area, 0);
  let selected = chosen.length;
  while (selected < sites.length - 1) {
    const options = chosen
      .map((anchor, n) => ({
        n,
        next: frontierSite(
          sites,
          result,
          n + 1,
          anchor,
          directions[n],
          width,
          regions[n % regions.length]
        ),
      }))
      .filter(
        ({ next }) => next >= 0 && Math.abs(total + areas[next] - target) < Math.abs(total - target)
      );
    if (!options.length) break;
    const pick = bestIndex(
      options.map((_, i) => i),
      (i) => {
        const { n, next } = options[i];
        return ((target * weights[n]) / weight - occupied[n] - areas[next] / 2) / weights[n];
      }
    );
    const { n, next } = options[pick];
    result[next] = n + 1;
    occupied[n] += areas[next];
    total += areas[next];
    selected++;
  }
  return result;
}
export function createProvinceSites(map: PhysicalField, context: PhysicalContext): ProvinceSite[] {
  const p = context.Profile,
    seed = context.EpochStableSeed;
  const candidates = worldCandidates(
    map.mesh,
    seed,
    p.TectonicProvinceCount * p.TectonicSiteCandidateMultiplier
  );
  // Independent seeded positions allow both sparse interiors and clusters of small blocks.
  // Farthest-site packing imposed a nearly uniform spacing before any geology occurred.
  const selected = [...candidates]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, p.TectonicProvinceCount);
  const width = map.mesh.periodic?.width ?? 0;
  const bounds = map.mesh.bounds;
  const provinceArea = ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / selected.length;
  const groups = assemblies(
    selected,
    provinceTerritories(selected, candidates, width),
    context,
    width,
    provinceArea
  );
  const motionOf = (salt: number, key: number): [number, number] => {
    const angle = hashUnit(seed ^ salt, key, 0) * Math.PI * 2;
    const speed = lerp(
      p.TectonicMotionMinimum,
      p.TectonicMotionMaximum,
      hashUnit(seed ^ (salt + 0x16da), key, 1)
    );
    return [Math.cos(angle) * speed, Math.sin(angle) * speed];
  };
  return selected.map((site, i) => {
    const own = motionOf(0x5c27, i);
    // A continent moves as one plate: its provinces share the assembly's motion, keeping only a
    // minority of their own, while oceanic provinces drift independently.
    const coherence = groups[i] > 0 ? p.AssemblyMotionCoherence : 0;
    const assembly = groups[i] > 0 ? motionOf(0x2e9b, groups[i]) : own;
    const motionX = lerp(own[0], assembly[0], coherence),
      motionY = lerp(own[1], assembly[1], coherence);
    return {
      ...site,
      x: site.x + motionX * map.AccumulatedPlateDrift,
      y: site.y + motionY * map.AccumulatedPlateDrift,
      assembly: groups[i],
      motionX,
      motionY,
    };
  });
}

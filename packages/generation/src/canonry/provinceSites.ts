// TectonicProvinceLayer.CreateSites and continental assembly growth, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { lerp } from "./math";
import { hashUnit } from "./noise";
import { worldCandidates } from "./worldSources";

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
const distance2 = (a: Candidate, b: Candidate) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
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
function minimumDistance(sites: Candidate[], candidate: number, selected: number[]): number {
  return selected.reduce(
    (minimum, i) => Math.min(minimum, distance2(sites[candidate], sites[i])),
    Infinity
  );
}
function territoryAreas(sites: Candidate[], samples: Candidate[]): Float64Array {
  // Uniform world-space samples estimate unwarped territory area independently of the mesh.
  // Every sample has the same represented area, so counts suffice for growth budgets.
  const areas = new Float64Array(sites.length);
  for (const sample of samples) {
    let nearest = 0;
    for (let i = 1; i < sites.length; i++)
      if (distance2(sample, sites[i]) < distance2(sample, sites[nearest])) nearest = i;
    areas[nearest]++;
  }
  return areas;
}
function anchors(sites: Candidate[], count: number, areas: Float64Array, target: number): number[] {
  const indices = sites.map((_, i) => i);
  // Seed each requested assembly without spending its whole area budget on a large block.
  const smaller = indices.filter((i) => areas[i] <= target / count);
  const candidates = smaller.length >= count ? smaller : indices;
  const chosen = [
    bestIndex(candidates, (i) => -radius2(sites[i]) / (0.8 + sites[i].priority * 0.4)),
  ];
  while (chosen.length < count)
    chosen.push(
      bestIndex(
        candidates.filter((i) => !chosen.includes(i)),
        (i) => minimumDistance(sites, i, chosen)
      )
    );
  return chosen;
}
function assemblyDistance(
  sites: Candidate[],
  selected: Int32Array,
  candidate: number,
  assembly: number,
  competing = false
): number {
  const indices = sites
    .map((_, i) => i)
    .filter((i) =>
      competing ? selected[i] !== 0 && selected[i] !== assembly : selected[i] === assembly
    );
  return minimumDistance(sites, candidate, indices);
}
function frontierSite(
  sites: Candidate[],
  selected: Int32Array,
  assembly: number,
  anchor: number,
  direction: [number, number]
): number {
  let best = -1,
    bestCost = Infinity;
  for (let candidate = 0; candidate < sites.length; candidate++) {
    if (selected[candidate] !== 0) continue;
    const frontier = assemblyDistance(sites, selected, candidate, assembly);
    if (assemblyDistance(sites, selected, candidate, assembly, true) < frontier * 0.62) continue;
    const dx = sites[candidate].x - sites[anchor].x,
      dy = sites[candidate].y - sites[anchor].y;
    const length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    const alignment = Math.abs((dx / length) * direction[0] + (dy / length) * direction[1]);
    const distance = Math.sqrt(frontier);
    const cost = distance * (1.12 - alignment * 0.48) - sites[candidate].priority * distance * 0.1;
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  if (best >= 0) return best;
  return bestIndex(
    sites.map((_, i) => i).filter((i) => selected[i] === 0),
    (i) => -assemblyDistance(sites, selected, i, assembly)
  );
}
function assemblies(sites: Candidate[], areas: Float64Array, context: PhysicalContext): Int32Array {
  const profile = context.Profile,
    seed = context.EpochStableSeed;
  const target = areas.reduce((sum, area) => sum + area, 0) * profile.ContinentalCrustFraction;
  const result = new Int32Array(sites.length),
    chosen = anchors(sites, profile.ContinentalAssemblyCount, areas, target);
  chosen.forEach((i, n) => {
    result[i] = n + 1;
  });
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
        next: frontierSite(sites, result, n + 1, anchor, directions[n]),
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
  const groups = assemblies(selected, territoryAreas(selected, candidates), context);
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

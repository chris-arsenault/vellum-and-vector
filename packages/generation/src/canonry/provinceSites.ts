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
interface MaterialGrowth {
  seed: number;
  cohesion: number;
  adjacent: Uint8Array;
}
const deltaX = (dx: number, width = 0) => (width ? dx - Math.round(dx / width) * width : dx);
const distance2 = (a: Candidate, b: Candidate, width = 0) =>
  deltaX(a.x - b.x, width) ** 2 + (a.y - b.y) ** 2;
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
  seed: number
): number[] {
  const indices = sites.map((_, i) => i);
  const { areas } = territory;
  // Seed each requested assembly without spending its whole area budget on a large block.
  const smaller = indices.filter((i) => areas[i] <= target / count);
  const candidates = smaller.length >= count ? smaller : indices;
  const chosen: number[] = [];
  while (chosen.length < count) {
    // Origins describe initial material, not a prescribed arrangement of final continents.
    const options = candidates.filter((i) => !chosen.includes(i));
    const next = bestIndex(options, (i) => hashUnit(seed ^ 0x41da3, i, chosen.length));
    chosen.push(next);
  }
  return chosen;
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
  material: MaterialGrowth
): number {
  let best = -1,
    bestCost = Infinity;
  const remaining = sites.map((_, i) => i).filter((i) => selected[i] === 0);
  const contiguous = remaining.filter((i) =>
    selected.some((id, j) => id === assembly && material.adjacent[i * sites.length + j])
  );
  const candidates = material.cohesion > 0 && contiguous.length ? contiguous : remaining;
  for (const candidate of candidates) {
    const frontier = assemblyDistance(sites, selected, candidate, assembly, false, width);
    if (assemblyDistance(sites, selected, candidate, assembly, true, width) < frontier * 0.62)
      continue;
    const dx = deltaX(sites[candidate].x - sites[anchor].x, width),
      dy = sites[candidate].y - sites[anchor].y;
    const length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    const alignment = Math.abs((dx / length) * direction[0] + (dy / length) * direction[1]);
    const distance = Math.sqrt(frontier);
    const heterogeneity =
      1 + material.cohesion * hashUnit(material.seed ^ 0x6173, candidate, assembly) * 0.7;
    const cost =
      distance * (1.12 - alignment * 0.48) * heterogeneity -
      sites[candidate].priority * distance * 0.1;
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
function assemblies(
  sites: Candidate[],
  territory: ProvinceTerritories,
  context: PhysicalContext,
  width: number
): Int32Array {
  const profile = context.Profile,
    seed = context.EpochStableSeed;
  const { areas } = territory;
  const target = areas.reduce((sum, area) => sum + area, 0) * profile.ContinentalCrustFraction;
  const result = new Int32Array(sites.length),
    chosen = anchors(sites, profile.ContinentalAssemblyCount, territory, target, seed);
  chosen.forEach((i, n) => {
    result[i] = n + 1;
  });
  const material: MaterialGrowth = {
    seed,
    cohesion: profile.ContinentalAssemblyClustering,
    adjacent: territory.adjacent,
  };
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
        next: frontierSite(sites, result, n + 1, anchor, directions[n], width, material),
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
    // hpc-exempt: seeded candidate objects, sorted once.
    .sort((a, b) => b.priority - a.priority)
    .slice(0, p.TectonicProvinceCount);
  const width = map.mesh.periodic?.width ?? 0;
  const groups = assemblies(
    selected,
    provinceTerritories(selected, candidates, width),
    context,
    width
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
    const [motionX, motionY] = motionOf(0x5c27, i);
    return {
      ...site,
      assembly: groups[i],
      motionX,
      motionY,
    };
  });
}

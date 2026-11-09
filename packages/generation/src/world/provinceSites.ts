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
  /** The ocean plate this province belongs to from the start, or 0. */
  oceanPlate: number;
  motionX: number;
  motionY: number;
}
interface MaterialGrowth {
  seed: number;
  cohesion: number;
  adjacent: Uint8Array;
}
type ProvinceLayout = Pick<
  PhysicalContext["Profile"],
  | "ContinentalAssemblyCount"
  | "ContinentalCrustFraction"
  | "ContinentalAssemblyClustering"
  | "ContinentalAssemblyGrowthVariation"
  | "ContinentalMajorAssemblies"
  | "ContinentalMajorGrowth"
  | "OceanicPlateCount"
  | "OceanicPlateWaterShare"
>;
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
/**
 * Starts each assembly away from the others, so they tend to grow into separate continents with
 * ocean between them. Chance still weighs in: origins favour no fixed arrangement.
 */
function anchors(
  sites: Candidate[],
  count: number,
  territory: ProvinceTerritories,
  target: number,
  seed: number,
  open: number[],
  width: number
): number[] {
  const { areas } = territory;
  // Seed each requested assembly without spending its whole area budget on a large block.
  const smaller = open.filter((i) => areas[i] <= target / count);
  const candidates = smaller.length >= count ? smaller : open;
  const chosen: number[] = [];
  let occupied = 0;
  while (chosen.length < Math.min(count, candidates.length)) {
    const options = candidates.filter(
      (i) =>
        !chosen.includes(i) && Math.abs(occupied + areas[i] - target) < Math.abs(occupied - target)
    );
    if (!options.length) break;
    const next = bestIndex(options, (i) => {
      const chance = hashUnit(seed ^ 0x41da3, i, chosen.length);
      return chosen.length
        ? Math.sqrt(minimumDistance(sites, i, chosen, width)) * lerp(0.5, 1, chance)
        : chance;
    });
    chosen.push(next);
    occupied += areas[next];
  }
  return chosen;
}
/** Ocean plates occupy only the remaining dense crust; exposure to water does not allocate it. */
function oceanPlates(
  sites: Candidate[],
  territory: ProvinceTerritories,
  profile: ProvinceLayout,
  seed: number,
  width: number,
  continents: Int32Array
) {
  const { areas, adjacent } = territory,
    result = new Int32Array(sites.length),
    count = profile.OceanicPlateCount,
    ocean = areas.reduce((sum, area, i) => sum + (continents[i] === 0 ? area : 0), 0),
    target = ocean * profile.OceanicPlateWaterShare;
  if (target <= 0) return result;
  const open = () => sites.map((_, i) => i).filter((i) => continents[i] === 0 && result[i] === 0);
  for (let plate = 1; plate <= count; plate++) {
    const starts = open();
    if (!starts.length) break;
    const start = bestIndex(starts, (i) => {
      const held = sites.map((_, j) => j).filter((j) => result[j] > 0),
        place = held.length ? Math.sqrt(minimumDistance(sites, i, held, width)) : 1;
      return place * hashUnit(seed ^ 0x37b1, i, plate);
    });
    result[start] = plate;
    let area = areas[start];
    while (area < target / count) {
      const edge = open().filter((i) =>
        result.some((id, j) => id === plate && adjacent[i * sites.length + j])
      );
      if (!edge.length) break;
      const next = bestIndex(edge, (i) => -distance2(sites[i], sites[start], width));
      result[next] = plate;
      area += areas[next];
    }
  }
  return result;
}
const touches = (
  count: number,
  selected: Int32Array,
  material: MaterialGrowth,
  site: number,
  test: (assembly: number) => boolean
) => selected.some((id, j) => test(id) && material.adjacent[site * count + j] === 1);
/** Compact accretion follows existing contacts; the dispersed mode permits isolated fragments. */
export function nextContinentalProvince(
  sites: Candidate[],
  selected: Int32Array,
  assembly: number,
  anchor: number,
  width: number,
  material: MaterialGrowth,
  eligible: (site: number) => boolean = () => true
): number {
  let best = -1,
    bestCost = Infinity;
  const remaining = sites.map((_, i) => i).filter((i) => selected[i] === 0 && eligible(i));
  const contiguous = remaining.filter((i) =>
    touches(sites.length, selected, material, i, (id) => id === assembly)
  );
  const candidates = material.cohesion > 0 ? contiguous : remaining;
  for (const candidate of candidates) {
    // Accretion stays around its cratonic nucleus instead of extending the nearest branch.
    const distance = Math.sqrt(distance2(sites[candidate], sites[anchor], width));
    const heterogeneity =
      1 + material.cohesion * hashUnit(material.seed ^ 0x6173, candidate, assembly) * 0.7;
    const cost =
      material.cohesion > 0
        ? distance * heterogeneity - sites[candidate].priority * distance * 0.1
        : -hashUnit(material.seed ^ 0x6173, candidate, assembly);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}
/** Each assembly's share of the land: varied by chance, with the largest few favoured. */
function growthWeights(count: number, profile: ProvinceLayout, seed: number) {
  const weights = Array.from(
    { length: count },
    (_, i) =>
      1 + (hashUnit(seed ^ 0x4b19, i, 0) * 2 - 1) * profile.ContinentalAssemblyGrowthVariation
  );
  // hpc-exempt: initial assembly weights, sorted once; ties still select only the requested majors.
  const order = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a]),
    major = new Uint8Array(count);
  for (const i of order.slice(0, profile.ContinentalMajorAssemblies)) major[i] = 1;
  return weights.map((w, i) => (major[i] ? w * profile.ContinentalMajorGrowth : w));
}
function assemblies(
  sites: Candidate[],
  territory: ProvinceTerritories,
  profile: ProvinceLayout,
  seed: number,
  width: number
): Int32Array {
  const { areas } = territory;
  const target = areas.reduce((sum, area) => sum + area, 0) * profile.ContinentalCrustFraction;
  const open = sites.map((_, i) => i).filter((i) => areas[i] > 0);
  const result = new Int32Array(sites.length),
    chosen = anchors(sites, profile.ContinentalAssemblyCount, territory, target, seed, open, width);
  chosen.forEach((i, n) => {
    result[i] = n + 1;
  });
  const material: MaterialGrowth = {
    seed,
    cohesion: profile.ContinentalAssemblyClustering,
    adjacent: territory.adjacent,
  };
  const weights = growthWeights(chosen.length, profile, seed);
  const weight = weights.reduce((sum, value) => sum + value, 0);
  const occupied = Float64Array.from(chosen, (i) => areas[i]);
  let total = occupied.reduce((sum, area) => sum + area, 0);
  let selected = chosen.length;
  while (selected < sites.length) {
    const options = chosen
      .map((anchor, n) => ({
        n,
        next: nextContinentalProvince(
          sites,
          result,
          n + 1,
          anchor,
          width,
          material,
          (i) => Math.abs(total + areas[i] - target) < Math.abs(total - target)
        ),
      }))
      .filter(({ next }) => next >= 0);
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
/** Initial buoyant assemblies accrete first; unclaimed provinces remain oceanic crust. */
export function allocateProvinceCrust(
  sites: Candidate[],
  territory: ProvinceTerritories,
  profile: ProvinceLayout,
  seed: number,
  width: number
) {
  const continents = assemblies(sites, territory, profile, seed, width),
    oceans = oceanPlates(sites, territory, profile, seed, width, continents);
  return { continents, oceans };
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
  const width = map.mesh.periodic?.width ?? 0,
    territory = provinceTerritories(selected, map.mesh.bounds, width),
    { oceans, continents } = allocateProvinceCrust(selected, territory, p, seed, width);
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
      assembly: continents[i],
      oceanPlate: oceans[i],
      motionX,
      motionY,
    };
  });
}

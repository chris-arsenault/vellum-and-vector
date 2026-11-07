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
  /** The ocean plate this province belongs to from the start, or 0. */
  oceanPlate: number;
  motionX: number;
  motionY: number;
}
interface MaterialGrowth {
  seed: number;
  cohesion: number;
  adjacent: Uint8Array;
  /** Provinces no continent may grow into, by the ocean plate that holds them. */
  oceanPlates: Int32Array;
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
  while (chosen.length < Math.min(count, candidates.length)) {
    const options = candidates.filter((i) => !chosen.includes(i));
    const next = bestIndex(options, (i) => {
      const chance = hashUnit(seed ^ 0x41da3, i, chosen.length);
      return chosen.length ? Math.sqrt(minimumDistance(sites, i, chosen, width)) * chance : chance;
    });
    chosen.push(next);
  }
  return chosen;
}
/** Grows each ocean plate as one compact block of provinces from its own start. */
function oceanPlates(
  sites: Candidate[],
  territory: ProvinceTerritories,
  profile: PhysicalContext["Profile"],
  seed: number,
  width: number,
  [west, south, east, north]: readonly number[]
) {
  // The first ocean tends to open across the map's seam, with the land between its shores in view.
  const seamward = ({ x, y }: Candidate) =>
    ((2 * x - west - east) / (east - west)) ** 2 *
    (1 - ((2 * y - south - north) / (north - south)) ** 2);
  const { areas, adjacent } = territory,
    result = new Int32Array(sites.length),
    count = profile.OceanicPlateCount,
    world = areas.reduce((sum, area) => sum + area, 0),
    water = world * (1 - profile.ContinentalCrustFraction) * profile.OceanicPlateWaterShare;
  const open = () => sites.map((_, i) => i).filter((i) => result[i] === 0);
  for (let plate = 1; plate <= count; plate++) {
    const starts = open();
    if (!starts.length) break;
    const start = bestIndex(starts, (i) => {
      const held = sites.map((_, j) => j).filter((j) => result[j] > 0),
        place = held.length
          ? Math.sqrt(minimumDistance(sites, i, held, width))
          : seamward(sites[i]);
      return place * hashUnit(seed ^ 0x37b1, i, plate);
    });
    result[start] = plate;
    let area = areas[start];
    while (area < water / count) {
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
const touches = (
  count: number,
  selected: Int32Array,
  material: MaterialGrowth,
  site: number,
  test: (assembly: number) => boolean
) => selected.some((id, j) => test(id) && material.adjacent[site * count + j] === 1);
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
  const remaining = sites
    .map((_, i) => i)
    .filter((i) => selected[i] === 0 && material.oceanPlates[i] === 0);
  const contiguous = remaining.filter((i) =>
    touches(sites.length, selected, material, i, (id) => id === assembly)
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
/** Each assembly's share of the land: varied by chance, with the largest few favoured. */
function growthWeights(count: number, profile: PhysicalContext["Profile"], seed: number) {
  const weights = Array.from(
    { length: count },
    (_, i) =>
      1 + (hashUnit(seed ^ 0x4b19, i, 0) * 2 - 1) * profile.ContinentalAssemblyGrowthVariation
  );
  // hpc-exempt: a handful of assembly weights, sorted once.
  const threshold = [...weights].sort((a, b) => b - a)[profile.ContinentalMajorAssemblies - 1];
  return weights.map((w) => (w >= threshold ? w * profile.ContinentalMajorGrowth : w));
}
function assemblies(
  sites: Candidate[],
  territory: ProvinceTerritories,
  context: PhysicalContext,
  width: number,
  held: Int32Array
): Int32Array {
  const profile = context.Profile,
    seed = context.EpochStableSeed;
  const { areas } = territory;
  const target = areas.reduce((sum, area) => sum + area, 0) * profile.ContinentalCrustFraction;
  const open = sites.map((_, i) => i).filter((i) => held[i] === 0);
  const result = new Int32Array(sites.length),
    chosen = anchors(sites, profile.ContinentalAssemblyCount, territory, target, seed, open, width);
  chosen.forEach((i, n) => {
    result[i] = n + 1;
  });
  const material: MaterialGrowth = {
    seed,
    cohesion: profile.ContinentalAssemblyClustering,
    adjacent: territory.adjacent,
    oceanPlates: held,
  };
  const directions = chosen.map((_, i): [number, number] => {
    const angle = hashUnit(seed ^ 0x67d3, i, 0) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const weights = growthWeights(chosen.length, profile, seed);
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
  const width = map.mesh.periodic?.width ?? 0,
    territory = provinceTerritories(selected, map.mesh.bounds, width),
    held = oceanPlates(selected, territory, p, seed, width, map.mesh.bounds),
    groups = assemblies(selected, territory, context, width, held);
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
      oceanPlate: held[i],
      motionX,
      motionY,
    };
  });
}

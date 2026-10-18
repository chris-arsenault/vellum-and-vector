// TectonicProvinceLayer.CreateSites and continental assembly growth, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, lerp, round } from "./math";
import { hashUnit } from "./noise";

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
function separated(candidates: Candidate[], count: number): Candidate[] {
  const indices = candidates.map((_, i) => i);
  const selected = [bestIndex(indices, (i) => candidates[i].priority)];
  while (selected.length < count)
    selected.push(
      bestIndex(
        indices,
        (i) => minimumDistance(candidates, i, selected) * (0.88 + candidates[i].priority * 0.24)
      )
    );
  return selected.map((i) => candidates[i]);
}
function anchors(sites: Candidate[], count: number, radius: number): number[] {
  let candidates = sites.map((_, i) => i).filter((i) => radius2(sites[i]) <= radius * radius);
  if (candidates.length < count) candidates = sites.map((_, i) => i);
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
function assemblies(sites: Candidate[], context: PhysicalContext, radius: number): Int32Array {
  const profile = context.Profile,
    seed = context.EpochStableSeed;
  const count = clamp(round(sites.length * profile.ContinentalCrustFraction), 2, sites.length - 2);
  const result = new Int32Array(sites.length),
    chosen = anchors(sites, profile.ContinentalAssemblyCount, radius);
  chosen.forEach((i, n) => {
    result[i] = n + 1;
  });
  const directions = chosen.map((_, i): [number, number] => {
    const angle = hashUnit(seed ^ 0x67d3, i, 0) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  let selected = chosen.length,
    iteration = 0;
  while (selected < count) {
    const start = ((seed + iteration * 397) >>> 0) % chosen.length;
    for (let offset = 0; offset < chosen.length && selected < count; offset++) {
      const n = (start + offset) % chosen.length;
      const next = frontierSite(sites, result, n + 1, chosen[n], directions[n]);
      if (next >= 0) {
        result[next] = n + 1;
        selected++;
      }
    }
    iteration++;
  }
  return result;
}
export function createProvinceSites(map: PhysicalField, context: PhysicalContext): ProvinceSite[] {
  const p = context.Profile,
    seed = context.EpochStableSeed,
    radius = map.mesh.workRadius * 0.94;
  const candidates = Array.from(
    { length: p.TectonicProvinceCount * p.TectonicSiteCandidateMultiplier },
    (_, i) => {
      const angle = hashUnit(seed ^ 0x1b73, i, 0) * Math.PI * 2;
      const r = Math.sqrt(hashUnit(seed ^ 0x2db9, i, 1)) * radius;
      return {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        priority: hashUnit(seed ^ 0x4a91, i, 2),
      };
    }
  );
  const selected = separated(candidates, p.TectonicProvinceCount);
  const groups = assemblies(selected, context, map.mesh.contentRadius * 0.94);
  return selected.map((site, i) => {
    const angle = hashUnit(seed ^ 0x5c27, i, 0) * Math.PI * 2;
    const speed = lerp(
      p.TectonicMotionMinimum,
      p.TectonicMotionMaximum,
      hashUnit(seed ^ 0x73a1, i, 1)
    );
    const motionX = Math.cos(angle) * speed,
      motionY = Math.sin(angle) * speed;
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

import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { macroComponents } from "./macroRegions";
import { normalizeCommunities, updateTreeCover } from "./ecologyGrowth";
import { canopy } from "./ecologyGroups";

const communityFields = [
  "GrassCover",
  "BroadleafCover",
  "ConiferCover",
  "WetlandCover",
  "AlteredCover",
  "BroadleafSaplings",
  "ConiferSaplings",
  "AlteredSaplings",
  "GrassSeed",
  "BroadleafSeed",
  "ConiferSeed",
  "WetlandSeed",
  "AlteredSeed",
  "SoilDepth",
  "SoilWater",
  "MineralNutrients",
  "Productivity",
  "SoilCarbon",
  "PeatCarbon",
  "FireActivity",
  "EcologicalDamage",
  "EcologicalAlteration",
  "EcologicalToxicity",
  "ColdAdaptation",
  "DroughtAdaptation",
] as const;
function standKey(work: AtlasPhysicalWorkspace, i: number) {
  const map = work.map;
  return (
    Math.floor(map.CanopyAge[i] / 80) * 16 +
    Number(map.FireActivity[i] > 0.25) * 8 +
    Number(map.EcologicalDamage[i] > 0.25) * 4 +
    Number(map.AlteredCover[i] > 0.2) * 2 +
    Number(map.ConiferCover[i] > map.BroadleafCover[i])
  );
}
function standGroups(work: AtlasPhysicalWorkspace, original: Uint8Array) {
  const groups: number[][] = [];
  for (const component of macroComponents(work.map.mesh, (i) => Boolean(original[i]))) {
    const stands = new Map<number, number[]>();
    for (const i of component) {
      const key = standKey(work, i),
        cells = stands.get(key) ?? [];
      cells.push(i);
      stands.set(key, cells);
    }
    groups.push(...stands.values());
  }
  return groups;
}

/** Exchange actual communities and soil context, retaining age and disturbance stands. */
export function extendCommunities(
  work: AtlasPhysicalWorkspace,
  original: Uint8Array,
  mask: Uint8Array,
  sources: Int32Array
) {
  relocateCommunities(work, original, mask, sources);
  const mesh = work.map.mesh,
    labels = new Int32Array(mesh.count).fill(-1),
    groups = standGroups(work, original),
    ages = new Float64Array(mesh.count);
  groups.forEach((cells, n) => {
    for (const i of cells) labels[i] = n;
  });
  const added = groups.map(() => [] as number[]);
  for (let i = 0; i < mask.length; i++) {
    const source = sources[i];
    if (mask[i] && !original[i] && source >= 0 && labels[source] >= 0)
      added[labels[source]].push(i);
  }
  groups.forEach((cells, n) => exchange(work, cells, added[n], ages));
}
function relocateCommunities(
  work: AtlasPhysicalWorkspace,
  original: Uint8Array,
  mask: Uint8Array,
  sources: Int32Array
) {
  const mesh = work.map.mesh,
    labels = new Int32Array(mesh.count).fill(-1),
    added = Array.from(mask.keys()).filter((i) => mask[i] && !original[i]);
  standGroups(work, original).forEach((cells, group) => cells.forEach((i) => (labels[i] = group)));
  for (let i = 0; i < mask.length; i++) {
    if (!original[i] || mask[i]) continue;
    if (!added.length) {
      mask[i] = 1;
      continue;
    }
    let at = -1;
    for (let n = 0; n < added.length; n++) {
      if (labels[sources[added[n]]] !== labels[i]) continue;
      const distance = (j: number) => Math.hypot(mesh.x[i] - mesh.x[j], mesh.y[i] - mesh.y[j]);
      if (at < 0 || distance(added[n]) < distance(added[at])) at = n;
    }
    if (at < 0) {
      mask[i] = 1;
      continue;
    }
    const j = added.splice(at, 1)[0];
    exchangeParcels(work, i, j);
    original[i] = 0;
    original[j] = 1;
  }
}
function exchangeParcels(work: AtlasPhysicalWorkspace, i: number, j: number) {
  const map = work.map,
    mesh = map.mesh,
    area = Math.min(mesh.areas[i], mesh.areas[j]),
    a = area / mesh.areas[i],
    b = area / mesh.areas[j],
    ageI = map.CanopyAge[i] * canopy(map, i),
    ageJ = map.CanopyAge[j] * canopy(map, j);
  for (const name of communityFields) {
    const left = map[name][i],
      right = map[name][j];
    map[name][i] = left * (1 - a) + right * a;
    map[name][j] = right * (1 - b) + left * b;
  }
  updateTreeCover(map, i);
  updateTreeCover(map, j);
  map.CanopyAge[i] = canopy(map, i) ? (ageI * (1 - a) + ageJ * a) / canopy(map, i) : 0;
  map.CanopyAge[j] = canopy(map, j) ? (ageJ * (1 - b) + ageI * b) / canopy(map, j) : 0;
}
function exchange(
  work: AtlasPhysicalWorkspace,
  original: number[],
  added: number[],
  ages: Float64Array
) {
  if (!added.length) return;
  const map = work.map,
    mesh = map.mesh,
    area = (cells: number[]) => cells.reduce((sum, i) => sum + mesh.areas[i], 0),
    sourceArea = area(original),
    targetArea = area(added),
    fraction = Math.min(0.8, sourceArea / targetArea),
    returning = (fraction * targetArea) / sourceArea,
    cells = [...original, ...added];
  for (const i of cells) ages[i] = map.CanopyAge[i] * canopy(map, i);
  const mix = (values: Float64Array) => {
    const mean = (members: number[], size: number) =>
        members.reduce((sum, i) => sum + values[i] * mesh.areas[i], 0) / size,
      from = mean(original, sourceArea),
      to = mean(added, targetArea);
    for (const i of original) values[i] = values[i] * (1 - returning) + to * returning;
    for (const i of added) values[i] = values[i] * (1 - fraction) + from * fraction;
  };
  for (const name of communityFields) mix(map[name]);
  mix(ages);
  for (const i of cells) {
    normalizeCommunities(map, i);
    updateTreeCover(map, i);
    map.CanopyAge[i] = canopy(map, i) > 0 ? ages[i] / canopy(map, i) : 0;
  }
}

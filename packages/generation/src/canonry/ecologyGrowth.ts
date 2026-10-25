import type { PhysicalField } from "./field";
import { approach, environment, unit, type EcologyForcing } from "./ecologyEnvironment";
import { canopy, groupSuitability, plantCover, plantGroups } from "./ecologyGroups";
import type { PlantArrival } from "./ecologyEstablishment";

function logistic(value: number, rate: number, years: number, capacity: number) {
  if (rate <= 0) return value * Math.exp(rate * years);
  if (capacity <= 0 || value <= 0) return 0;
  if (value >= capacity) return capacity / (1 + (capacity / value - 1) * Math.exp(-rate * years));
  const odds = Math.log(capacity - value) - Math.log(value) - rate * years;
  return odds > 0
    ? (capacity * Math.exp(-odds)) / (1 + Math.exp(-odds))
    : capacity / (1 + Math.exp(odds));
}
function proposal(
  map: PhysicalField,
  arrival: PlantArrival,
  i: number,
  years: number,
  f: EcologyForcing
) {
  const group = arrival.group,
    previous = plantCover(map, group, i);
  // Below the fronts' presence threshold a group is locally extinct and must arrive again.
  const available = previous > 0.00001 ? years : Math.max(0, years - arrival.front.time[i]);
  // Verdure establishes on bare ground where no seed bank has formed: the oasis at a spring.
  const seed = available > 0 ? 0.001 * Math.max(map[group.seed][i], 0.01 + 0.3 * f.verdure) : 0;
  const suitable = groupSuitability(map, group, i, f);
  const browsing = group.juvenile ? map.Browsers[i] * 0.7 : map.Grazers[i] * 2;
  const toxicity = map.EcologicalToxicity[i] * 0.02;
  const fire = map.FireActivity[i] * f.fireRegime * (group.id === "grass" ? 0.003 : 0.025);
  const flood = map.FloodFrequency[i] * group.floodSensitivity;
  // Quickened plants mature early and die young; stilled plants stand past their span.
  const turnover = (1 + 3 * f.quickening) * (1 - 0.85 * f.stillness);
  // Salted ground thins what grows on it: the residue is a standing mortality.
  const mortality =
    turnover / group.lifespan +
    (1 - suitable) / 100 +
    browsing +
    toxicity +
    fire +
    flood +
    0.05 * f.salting;
  const rate =
    (2 / group.maturity) *
      suitable *
      Math.max(0, 1 + f.growth) *
      f.productivity *
      (1 + 2 * f.quickening) *
      (1 - 0.7 * f.stillness) *
      (1 + f.verdure) *
      (1 - 0.8 * f.salting) -
    mortality;
  const cover = logistic(Math.max(previous, seed), rate, available, suitable);
  return {
    group,
    cover,
    mortality,
    available,
    elapsed: years,
    previous,
    mature: 0,
    young: 0,
    retained: 0,
    quickening: f.quickening,
    stillness: f.stillness,
  };
}
type Proposal = ReturnType<typeof proposal>;
function competition(proposals: Proposal[]) {
  const canopyPressure = proposals
    .filter((p) => p.group.juvenile)
    .reduce((sum, p) => sum + p.cover, 0);
  for (const p of proposals) if (p.group.id === "grass") p.cover *= Math.exp(-canopyPressure * 1.5);
  const total = proposals.reduce((sum, p) => sum + p.cover, 0);
  if (total > 1) for (const p of proposals) p.cover /= total;
}
function allocateNutrients(map: PhysicalField, i: number, proposals: Proposal[]) {
  for (const p of proposals) prepareCohort(map, i, p);
  const required = proposals.reduce(
    (sum, p) => sum + Math.max(0, proposedCarbon(p) - cohortCarbon(map, i, p)) / p.group.nitrogen,
    0
  );
  const uptake = Math.min(map.MineralNutrients[i], required);
  const fraction = required > 0 ? uptake / required : 1;
  for (const p of proposals) {
    if (proposedCarbon(p) <= cohortCarbon(map, i, p)) continue;
    p.mature = map[p.group.cover][i] + (p.mature - map[p.group.cover][i]) * fraction;
    const young = p.group.juvenile ? map[p.group.juvenile][i] : 0;
    p.young = young + (p.young - young) * fraction;
    p.cover = p.mature + p.young;
  }
  map.MineralNutrients[i] -= uptake;
}
function prepareCohort(map: PhysicalField, i: number, p: Proposal) {
  if (!p.group.juvenile) {
    p.mature = p.cover;
    return;
  }
  const survivors = Math.min(p.cover, map[p.group.cover][i] * Math.exp(-p.mortality * p.available));
  p.retained = survivors;
  p.mature = survivors + (p.cover - survivors) * -Math.expm1(-p.available / p.group.maturity);
  p.young = Math.max(0, p.cover - p.mature);
}
const proposedCarbon = (p: Proposal) => (p.mature + p.young * 0.2) * p.group.mass;
const cohortCarbon = (map: PhysicalField, i: number, p: Proposal) =>
  (map[p.group.cover][i] + (p.group.juvenile ? map[p.group.juvenile][i] * 0.2 : 0)) * p.group.mass;
function growCohort(map: PhysicalField, i: number, p: Proposal) {
  const group = p.group;
  const before =
    map[group.cover][i] * group.mass +
    (group.juvenile ? map[group.juvenile][i] * group.mass * 0.2 : 0);
  map[group.cover][i] = p.mature;
  if (group.juvenile) map[group.juvenile][i] = p.young;
  const after =
    map[group.cover][i] * group.mass +
    (group.juvenile ? map[group.juvenile][i] * group.mass * 0.2 : 0);
  map.SoilCarbon[i] += Math.max(0, before - after);
  const viability = p.cover > 0.0001 ? unit(map[group.cover][i] * 0.3) : 0;
  // Quickened plants seed heavily; stilled ones hardly set seed at all.
  const seeding =
    (group.juvenile ? 80 : 20) / Math.max(0.05, (1 + 2 * p.quickening) * (1 - 0.9 * p.stillness));
  map[group.seed][i] = approach(map[group.seed][i], viability, p.elapsed, seeding);
}
export function updateTreeCover(map: PhysicalField, i: number) {
  map.TreeCover[i] = unit(
    canopy(map, i) + (map.BroadleafSaplings[i] + map.ConiferSaplings[i]) * 0.35
  );
}
/** Shared resources and cohort survival determine cover; biome names never enter growth. */
export function growCommunities(
  map: PhysicalField,
  years: number,
  arrivals: PlantArrival[],
  forcing: (i: number) => EcologyForcing,
  restore: (i: number) => void
) {
  for (let i = 0; i < map.mesh.count; i++) {
    const f = forcing(i),
      e = environment(map, i, f);
    const proposals = arrivals.map((arrival) => proposal(map, arrival, i, years, f));
    competition(proposals);
    allocateNutrients(map, i, proposals);
    for (const p of proposals) growCohort(map, i, p);
    updateTreeCover(map, i);
    restore(i);
    canopyAge(map, i, years, proposals);
    map.Productivity[i] =
      plantGroups.reduce(
        (sum, group) =>
          sum +
          groupSuitability(map, group, i, f) *
            plantCover(map, group, i) *
            (group.juvenile ? 0.65 : 0.4),
        0
      ) *
      f.productivity *
      Math.max(0, 1 + f.growth) *
      (1 + f.quickening) *
      (1 - 0.5 * f.stillness) *
      // Salted soil is infertile.
      (1 - 0.8 * f.salting);
    const light = Math.exp(-e.depth / 100),
      wet = e.water > 0 || e.wetness > 0.5;
    // Upwelling returns deep nutrients to the sunlit surface.
    const nutrients = 1 + (1.5 * map.Upwelling[i]) / 1000;
    map.AquaticProductivity[i] =
      wet && !e.frozen ? 0.18 * e.warmth * light * nutrients * f.productivity : 0;
  }
}
function canopyAge(map: PhysicalField, i: number, years: number, proposals: Proposal[]) {
  const weightedAge = proposals.reduce((sum, p) => {
    if (!p.group.juvenile) return sum;
    const cover = map[p.group.cover][i],
      retained = Math.min(cover, p.retained);
    const replacementAge = Math.min(years / 2, 1 / p.mortality);
    return sum + retained * (map.CanopyAge[i] + years) + (cover - retained) * replacementAge;
  }, 0);
  map.CanopyAge[i] = canopy(map, i) > 0 ? weightedAge / canopy(map, i) : 0;
}
export function normalizeCommunities(map: PhysicalField, i: number) {
  const total = plantGroups.reduce((sum, group) => sum + plantCover(map, group, i), 0);
  if (total <= 1) return;
  for (const group of plantGroups) {
    map[group.cover][i] /= total;
    if (group.juvenile) map[group.juvenile][i] /= total;
  }
}
export function authoritativeCanopy(map: PhysicalField, i: number, requested: number) {
  updateTreeCover(map, i);
  const represented = map.TreeCover[i];
  if (represented === 0) map.BroadleafCover[i] = requested;
  else
    for (const group of plantGroups.filter((g) => g.juvenile)) {
      map[group.cover][i] *= requested / represented;
      if (group.juvenile) map[group.juvenile][i] *= requested / represented;
    }
  map.TreeCover[i] = requested;
}

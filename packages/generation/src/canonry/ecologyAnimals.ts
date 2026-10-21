import type { PhysicalField } from "./field";
import { environment, approach, unit, type EcologyForcing } from "./ecologyEnvironment";
import { migrateAnimals } from "./ecologyMovement";
import { crossingTime, waterDistance, type Crossing } from "./ecologyCrossing";

function populationResponse(value: number, capacity: number, years: number, time: number) {
  if (value <= 0) return 0;
  if (capacity <= value) return approach(value, capacity, years, 3);
  return capacity / (1 + (capacity / value - 1) * Math.exp(-years / time));
}

function forage(map: PhysicalField, i: number, browser: boolean) {
  const palatable = unit(1 - map.EcologicalToxicity[i] * (0.5 + map.AlteredCover[i]));
  const food = browser
    ? map.TreeCover[i] * 0.018
    : map.GrassCover[i] * 0.08 + map.WetlandCover[i] * 0.025;
  return food * map.Productivity[i] * palatable;
}
function consume(
  map: PhysicalField,
  population: Float64Array,
  capacity: Float64Array,
  i: number,
  years: number,
  browser: boolean
) {
  const e = environment(map, i);
  const danger = e.frozen || e.submerged ? 1 : map.EcologicalToxicity[i];
  const predation = map.Predators[i] * 0.4;
  const target = (capacity[i] / (1 + predation * 30)) * (1 - danger);
  const before = population[i];
  population[i] = populationResponse(before, target, years, 12);
  const eating = eatPlants(map, i, population[i] * 3 * -Math.expm1(-years), browser);
  map.SoilCarbon[i] += Math.max(0, before - population[i]) * 0.7 + eating * 0.3;
}
function eatPlants(map: PhysicalField, i: number, demand: number, browser: boolean) {
  if (!browser) {
    const eaten = Math.min(map.GrassCover[i] * 0.9, demand);
    map.GrassCover[i] = Math.max(0, map.GrassCover[i] - eaten / 0.9);
    return eaten;
  }
  const edible = map.BroadleafSaplings[i] * 2 + map.ConiferSaplings[i] * 1.6;
  const eaten = Math.min(edible, demand),
    fraction = eaten / Math.max(1e-9, edible);
  map.BroadleafSaplings[i] *= 1 - fraction;
  map.ConiferSaplings[i] *= 1 - fraction;
  return eaten;
}
const animalCrossing: Crossing = { carrier: "current", reach: 120_000, interval: 50 };
/**
 * Rare swimmers and rafters found a small population on unoccupied land with
 * food, once a crossing from occupied land would arrive within the epoch.
 */
function foundAcrossWater(
  map: PhysicalField,
  population: Float64Array,
  capacity: Float64Array,
  years: number
) {
  const landed = waterDistance(
    map,
    (i) => population[i] > 1e-6,
    animalCrossing.carrier,
    animalCrossing.reach * 6
  );
  for (let i = 0; i < population.length; i++)
    if (population[i] < 1e-7 && capacity[i] > 0 && crossingTime(animalCrossing, landed[i]) <= years)
      population[i] = capacity[i] * 0.01;
}
/** Food and prey create carrying budgets; migration moves the existing populations first. */
export function evolveAnimals(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
) {
  const graze = Float64Array.from(
    map.TreeCover,
    (_, i) => forage(map, i, false) * forcing(i).grazing
  );
  const browse = Float64Array.from(
    map.TreeCover,
    (_, i) => forage(map, i, true) * forcing(i).grazing
  );
  const aquatic = Float64Array.from(
    map.TreeCover,
    (_, i) => map.AquaticProductivity[i] * 0.12 * (1 - map.EcologicalToxicity[i])
  );
  const speed = forcing(0).migration;
  migrateAnimals(map, map.Grazers, graze, years, 12_000 * speed);
  migrateAnimals(map, map.Browsers, browse, years, 8000 * speed);
  foundAcrossWater(map, map.Grazers, graze, years);
  foundAcrossWater(map, map.Browsers, browse, years);
  migrateAnimals(map, map.AquaticFauna, aquatic, years, 20_000 * speed, true);
  for (let i = 0; i < map.mesh.count; i++) {
    consume(map, map.Grazers, graze, i, years, false);
    consume(map, map.Browsers, browse, i, years, true);
    map.Herbivores[i] = map.Grazers[i] + map.Browsers[i];
  }
  const prey = Float64Array.from(map.Herbivores, (value) => value * 0.08);
  migrateAnimals(map, map.Predators, prey, years, 18_000 * speed);
  foundAcrossWater(map, map.Predators, prey, years);
  for (let i = 0; i < map.mesh.count; i++) {
    const predation = Math.min(map.Herbivores[i], map.Predators[i] * 2);
    const fraction = predation / Math.max(1e-9, map.Herbivores[i]);
    map.Grazers[i] *= 1 - fraction;
    map.Browsers[i] *= 1 - fraction;
    map.Herbivores[i] = map.Grazers[i] + map.Browsers[i];
    map.Predators[i] = populationResponse(
      map.Predators[i],
      prey[i] * (1 - map.EcologicalToxicity[i]),
      years,
      20
    );
    map.AquaticFauna[i] = populationResponse(map.AquaticFauna[i], aquatic[i], years, 5);
  }
}

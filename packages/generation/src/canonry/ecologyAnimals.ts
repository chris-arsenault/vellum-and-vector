import type { PhysicalField } from "./field";
import type { Band } from "@atlas/domain";
import { environment, approach, unit, type EcologyForcing } from "./ecologyEnvironment";
import { migrateAnimals } from "./ecologyMovement";
import { crossingTime, waterDistance, type Crossing } from "./ecologyCrossing";
import { workingValues, releaseWorking } from "./physicalNumerics";

function populationResponse(value: number, capacity: number, years: number, time: number) {
  if (value <= 0) return 0;
  if (capacity <= value) return approach(value, capacity, years, 3);
  return capacity / (1 + (capacity / value - 1) * Math.exp(-years / time));
}

function forage(map: PhysicalField, i: number, browser: boolean) {
  // Grazers avoid salted ground as they avoid poisoned ground.
  const palatable = unit(1 - map.EcologicalToxicity.get(i) * 0.5 - map.Salting.get(i));
  const food = browser
    ? map.TreeCover.get(i) * 0.018
    : map.GrassCover.get(i) * 0.08 + map.WetlandCover.get(i) * 0.025;
  return food * map.Productivity.get(i) * palatable;
}
function consume(
  map: PhysicalField,
  population: Band,
  capacity: Band,
  i: number,
  years: number,
  browser: boolean
) {
  const e = environment(map, i);
  const danger =
    e.frozen || e.submerged ? 1 : Math.max(map.EcologicalToxicity.get(i), map.Salting.get(i));
  const predation = map.Predators.get(i) * 0.4;
  const target = (capacity.get(i) / (1 + predation * 30)) * (1 - danger);
  const before = population.get(i);
  population.set(i, populationResponse(before, target, years, 12));
  const eating = eatPlants(map, i, population.get(i) * 3 * -Math.expm1(-years), browser);
  map.SoilCarbon.add(i, Math.max(0, before - population.get(i)) * 0.7 + eating * 0.3);
}
function eatPlants(map: PhysicalField, i: number, demand: number, browser: boolean) {
  if (!browser) {
    const eaten = Math.min(map.GrassCover.get(i) * 0.9, demand);
    map.GrassCover.set(i, Math.max(0, map.GrassCover.get(i) - eaten / 0.9));
    return eaten;
  }
  const edible = map.BroadleafSaplings.get(i) * 2 + map.ConiferSaplings.get(i) * 1.6;
  const eaten = Math.min(edible, demand),
    fraction = eaten / Math.max(1e-9, edible);
  map.BroadleafSaplings.set(i, map.BroadleafSaplings.get(i) * (1 - fraction));
  map.ConiferSaplings.set(i, map.ConiferSaplings.get(i) * (1 - fraction));
  return eaten;
}
const animalCrossing: Crossing = { carrier: "current", reach: 120_000, interval: 50 };
/**
 * Rare swimmers and rafters found a small population on unoccupied land with
 * food, once a crossing from occupied land would arrive within the epoch.
 */
function foundAcrossWater(map: PhysicalField, population: Band, capacity: Band, years: number) {
  const landed = waterDistance(
    map,
    (i) => population.get(i) > 1e-6,
    animalCrossing.carrier,
    animalCrossing.reach * 6
  );
  for (let i = 0; i < population.length; i++)
    if (
      population.get(i) < 1e-7 &&
      capacity.get(i) > 0 &&
      crossingTime(animalCrossing, landed.get(i)) <= years
    )
      population.set(i, capacity.get(i) * 0.01);
  releaseWorking(map, landed);
}
/** Food and prey create carrying budgets; migration moves the existing populations first. */
export function evolveAnimals(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing
) {
  const graze = workingValues(
    map,
    "float64",
    "ecology:grazing-capacity",
    (i) => forage(map, i, false) * forcing(i).grazing
  );
  const browse = workingValues(
    map,
    "float64",
    "ecology:browsing-capacity",
    (i) => forage(map, i, true) * forcing(i).grazing
  );
  const aquatic = workingValues(
    map,
    "float64",
    "ecology:aquatic-capacity",
    (i) => map.AquaticProductivity.get(i) * 0.12 * (1 - map.EcologicalToxicity.get(i))
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
    map.Herbivores.set(i, map.Grazers.get(i) + map.Browsers.get(i));
  }
  const prey = workingValues(
    map,
    "float64",
    "ecology:prey-capacity",
    (i) => map.Herbivores.get(i) * 0.08
  );
  migrateAnimals(map, map.Predators, prey, years, 18_000 * speed);
  foundAcrossWater(map, map.Predators, prey, years);
  for (let i = 0; i < map.mesh.count; i++) {
    const herbivores = map.Herbivores.get(i),
      predation = Math.min(herbivores, map.Predators.get(i) * 2);
    const fraction = predation / Math.max(1e-9, herbivores);
    map.Grazers.set(i, map.Grazers.get(i) * (1 - fraction));
    map.Browsers.set(i, map.Browsers.get(i) * (1 - fraction));
    map.Herbivores.set(i, map.Grazers.get(i) + map.Browsers.get(i));
    map.Predators.set(
      i,
      populationResponse(
        map.Predators.get(i),
        prey.get(i) * (1 - map.EcologicalToxicity.get(i)),
        years,
        20
      )
    );
    map.AquaticFauna.set(i, populationResponse(map.AquaticFauna.get(i), aquatic.get(i), years, 5));
  }
  releaseWorking(map, graze, browse, aquatic, prey);
}

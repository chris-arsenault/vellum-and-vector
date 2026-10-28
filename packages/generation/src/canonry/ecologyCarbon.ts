import type { PhysicalField } from "./field";
import { environment, neutralEcology, unit, type EcologyForcing } from "./ecologyEnvironment";

// Exact constant-input, first-order pool balance remains stable over geological time.
function pool(stock: number, input: number, loss: number, years: number) {
  return stock * Math.exp(-loss * years) + (input * -Math.expm1(-loss * years)) / loss;
}
export function accumulateOrganicMatter(
  map: PhysicalField,
  years: number,
  forcing: (i: number) => EcologyForcing = () => neutralEcology
) {
  for (let i = 0; i < map.mesh.count; i++) {
    const env = environment(map, i),
      f = forcing(i);
    const preservation = Math.exp(-Math.max(-3, Math.min(3, f.preservation)));
    const temperature = Math.exp((env.temperature - 15) / 25);
    const wet = env.submerged ? 1 : env.wetness;
    // Dead matter decays within a season under quickening and hardly at all when stilled.
    const pace = (1 + 3 * f.quickening) * (1 - 0.9 * f.stillness);
    const decay = (0.03 * (1 - wet) + 0.0003 * wet) * temperature * preservation * pace;
    const litter = map.Productivity.get(i) * (1 - map.FireActivity.get(i) * 0.8);
    map.SoilCarbon.set(i, pool(map.SoilCarbon.get(i), litter * (1 - wet), decay, years));
    map.PeatCarbon.set(i, pool(map.PeatCarbon.get(i), litter * wet, decay, years));
    const aquaticPreservation = env.water || wet > 0.5 ? 0.0005 : 0.04;
    map.AquaticCarbon.set(
      i,
      pool(
        map.AquaticCarbon.get(i),
        map.AquaticProductivity.get(i) * 0.3,
        aquaticPreservation * temperature * preservation,
        years
      )
    );
  }
}
const buried = [
  "BuriedPlantCarbon",
  "BuriedAquaticCarbon",
  "CoalCarbon",
  "OilCarbon",
  "GasCarbon",
] as const;
function burial(map: PhysicalField, i: number) {
  const sediment = map.SedimentThickness.get(i) / 1024;
  const delta = sediment - map.EcologySediment.get(i);
  const existing = buried.reduce((sum, name) => sum + map[name].get(i), 0);
  const oldDepth = map.OrganicBurialDepth.get(i);
  const depth = Math.max(0, oldDepth + delta);
  // Exhumation loses exposed source carbon; it never reverses thermal maturity.
  const exposed = delta < 0 ? unit((-delta - oldDepth) / Math.max(1, -delta)) : 0;
  for (const name of buried) map[name].set(i, map[name].get(i) * (1 - exposed));
  const fraction = -Math.expm1(-Math.max(0, delta) / 2);
  const plant = (map.SoilCarbon.get(i) + map.PeatCarbon.get(i)) * fraction;
  const aquatic = map.AquaticCarbon.get(i) * fraction;
  map.SoilCarbon.set(i, map.SoilCarbon.get(i) * (1 - fraction));
  map.PeatCarbon.set(i, map.PeatCarbon.get(i) * (1 - fraction));
  map.AquaticCarbon.set(i, map.AquaticCarbon.get(i) * (1 - fraction));
  map.BuriedPlantCarbon.add(i, plant);
  map.BuriedAquaticCarbon.add(i, aquatic);
  const retained = existing * (1 - exposed),
    total = retained + plant + aquatic;
  map.OrganicBurialDepth.set(
    i,
    total > 0 ? (retained * depth + ((plant + aquatic) * Math.max(0, delta)) / 2) / total : 0
  );
  map.OrganicMaturity.set(i, map.OrganicMaturity.get(i) * (total > 0 ? retained / total : 0));
  map.EcologySediment.set(i, sediment);
}
function mature(map: PhysicalField, i: number, years: number) {
  const depth = map.OrganicBurialDepth.get(i);
  // Geothermal ratio adds up to 40 C/km to a 25 C/km background gradient.
  const gradient = 0.025 + Math.max(0, map.Geothermal.get(i) / 1000) * 0.04;
  const temperature = map.Temperature.get(i) / 10 - 30 + depth * gradient;
  if (depth < 10 || years === 0) return;
  const dose = (years / 1_000_000) * Math.exp(Math.min(20, (temperature - 100) / 18));
  map.OrganicMaturity.add(i, dose);
  const conversion = temperature >= 60 ? -Math.expm1(-dose / 4) : 0;
  const plant = map.BuriedPlantCarbon.get(i) * conversion;
  const aquatic = map.BuriedAquaticCarbon.get(i) * conversion;
  map.BuriedPlantCarbon.add(i, -plant);
  map.BuriedAquaticCarbon.add(i, -aquatic);
  map.CoalCarbon.add(i, plant * 0.65);
  map.OilCarbon.add(i, aquatic * 0.7 + plant * 0.05);
  map.GasCarbon.add(i, aquatic * 0.3 + plant * 0.3);
  const cracked = temperature > 150 ? -Math.expm1(-dose / 12) : 0;
  const oil = map.OilCarbon.get(i) * cracked;
  const coal = map.CoalCarbon.get(i) * cracked * 0.3;
  map.OilCarbon.add(i, -oil);
  map.CoalCarbon.add(i, -coal);
  map.GasCarbon.add(i, oil + coal);
}
/** Sediment gain and thermal exposure are necessary; age alone cannot make oil. */
export function evolveBuriedCarbon(map: PhysicalField, years: number) {
  for (let i = 0; i < map.mesh.count; i++) {
    burial(map, i);
    mature(map, i, years);
  }
}

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
    const decay = (0.03 * (1 - wet) + 0.0003 * wet) * temperature * preservation;
    const litter = map.Productivity[i] * (1 - map.FireActivity[i] * 0.8);
    map.SoilCarbon[i] = pool(map.SoilCarbon[i], litter * (1 - wet), decay, years);
    map.PeatCarbon[i] = pool(map.PeatCarbon[i], litter * wet, decay, years);
    const aquaticPreservation = env.water || wet > 0.5 ? 0.0005 : 0.04;
    map.AquaticCarbon[i] = pool(
      map.AquaticCarbon[i],
      map.AquaticProductivity[i] * 0.3,
      aquaticPreservation * temperature * preservation,
      years
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
  const sediment = map.SedimentThickness[i] / 1024;
  const delta = sediment - map.EcologySediment[i];
  const existing = buried.reduce((sum, name) => sum + map[name][i], 0);
  const oldDepth = map.OrganicBurialDepth[i];
  const depth = Math.max(0, oldDepth + delta);
  // Exhumation loses exposed source carbon; it never reverses thermal maturity.
  const exposed = delta < 0 ? unit((-delta - oldDepth) / Math.max(1, -delta)) : 0;
  for (const name of buried) map[name][i] *= 1 - exposed;
  const fraction = -Math.expm1(-Math.max(0, delta) / 2);
  const plant = (map.SoilCarbon[i] + map.PeatCarbon[i]) * fraction;
  const aquatic = map.AquaticCarbon[i] * fraction;
  map.SoilCarbon[i] *= 1 - fraction;
  map.PeatCarbon[i] *= 1 - fraction;
  map.AquaticCarbon[i] *= 1 - fraction;
  map.BuriedPlantCarbon[i] += plant;
  map.BuriedAquaticCarbon[i] += aquatic;
  const retained = existing * (1 - exposed),
    total = retained + plant + aquatic;
  map.OrganicBurialDepth[i] =
    total > 0 ? (retained * depth + ((plant + aquatic) * Math.max(0, delta)) / 2) / total : 0;
  map.OrganicMaturity[i] *= total > 0 ? retained / total : 0;
  map.EcologySediment[i] = sediment;
}
function mature(map: PhysicalField, i: number, years: number) {
  const depth = map.OrganicBurialDepth[i];
  // Geothermal ratio adds up to 40 C/km to a 25 C/km background gradient.
  const gradient = 0.025 + Math.max(0, map.Geothermal[i] / 1000) * 0.04;
  const temperature = map.Temperature[i] / 10 - 30 + depth * gradient;
  if (depth < 10 || years === 0) return;
  const dose = (years / 1_000_000) * Math.exp(Math.min(20, (temperature - 100) / 18));
  map.OrganicMaturity[i] += dose;
  const conversion = temperature >= 60 ? -Math.expm1(-dose / 4) : 0;
  const plant = map.BuriedPlantCarbon[i] * conversion;
  const aquatic = map.BuriedAquaticCarbon[i] * conversion;
  map.BuriedPlantCarbon[i] -= plant;
  map.BuriedAquaticCarbon[i] -= aquatic;
  map.CoalCarbon[i] += plant * 0.65;
  map.OilCarbon[i] += aquatic * 0.7 + plant * 0.05;
  map.GasCarbon[i] += aquatic * 0.3 + plant * 0.3;
  const cracked = temperature > 150 ? -Math.expm1(-dose / 12) : 0;
  const oil = map.OilCarbon[i] * cracked;
  const coal = map.CoalCarbon[i] * cracked * 0.3;
  map.OilCarbon[i] -= oil;
  map.CoalCarbon[i] -= coal;
  map.GasCarbon[i] += oil + coal;
}
/** Sediment gain and thermal exposure are necessary; age alone cannot make oil. */
export function evolveBuriedCarbon(map: PhysicalField, years: number) {
  for (let i = 0; i < map.mesh.count; i++) {
    burial(map, i);
    mature(map, i, years);
  }
}

import type { PhysicalField } from "./field";
import { environment, unit, type EcologyForcing } from "./ecologyEnvironment";

export const plantGroups = [
  {
    id: "grass",
    cover: "GrassCover",
    seed: "GrassSeed",
    juvenile: null,
    mass: 0.9,
    maturity: 3,
    lifespan: 10,
    spread: 400,
    nitrogen: 45,
    shade: 0.15,
    waterlogging: 0.65,
    crossing: { carrier: "wind", reach: 400_000, interval: 20 },
    floodSensitivity: 0.05,
  },
  {
    id: "broadleaf",
    cover: "BroadleafCover",
    seed: "BroadleafSeed",
    juvenile: "BroadleafSaplings",
    mass: 10,
    maturity: 45,
    lifespan: 250,
    spread: 180,
    nitrogen: 90,
    shade: 0.65,
    waterlogging: 0.35,
    crossing: { carrier: "current", reach: 250_000, interval: 20 },
    floodSensitivity: 0.2,
  },
  {
    id: "conifer",
    cover: "ConiferCover",
    seed: "ConiferSeed",
    juvenile: "ConiferSaplings",
    mass: 8,
    maturity: 65,
    lifespan: 350,
    spread: 140,
    nitrogen: 110,
    shade: 0.5,
    waterlogging: 0.85,
    crossing: { carrier: "current", reach: 150_000, interval: 20 },
    floodSensitivity: 0.3,
  },
  {
    id: "wetland",
    cover: "WetlandCover",
    seed: "WetlandSeed",
    juvenile: null,
    mass: 1.8,
    maturity: 5,
    lifespan: 8,
    spread: 300,
    nitrogen: 55,
    shade: 0.5,
    waterlogging: 0,
    crossing: { carrier: "wind", reach: 300_000, interval: 20 },
    floodSensitivity: 0,
  },
] as const;
export type PlantGroup = (typeof plantGroups)[number];
export function plantCover(map: PhysicalField, group: PlantGroup, i: number) {
  return map[group.cover].get(i) + (group.juvenile ? map[group.juvenile].get(i) : 0);
}
export function canopy(map: PhysicalField, i: number) {
  return map.BroadleafCover.get(i) + map.ConiferCover.get(i);
}
export function livingPlantCarbon(map: PhysicalField, i: number) {
  return plantGroups.reduce(
    (sum, group) =>
      sum +
      map[group.cover].get(i) * group.mass +
      (group.juvenile ? map[group.juvenile].get(i) * group.mass * 0.2 : 0),
    0
  );
}
export function groupSuitability(
  map: PhysicalField,
  group: PlantGroup,
  i: number,
  f: EcologyForcing
) {
  const e = environment(map, i, f);
  if (e.submerged || e.frozen) return 0;
  const cold = group.id === "conifer" ? -28 : group.id === "grass" ? -20 : -12;
  const warmth = unit((e.summer + 4) / 18) * unit((55 - e.summer) / 15);
  const frost = unit((e.winter - cold) / 15);
  const drought = unit(1 - e.drought);
  const wet = group.id === "wetland" ? e.wetness : 1 - e.wetness * group.waterlogging;
  const shade = unit(1 - canopy(map, i) * (1 - group.shade));
  const soil = unit(map.SoilDepth.get(i) / (group.juvenile ? 0.3 : 0.06));
  const heatPreference = group.id === "conifer" ? unit((25 - e.temperature) / 12) : 1;
  const climate = warmth * frost * drought * wet * soil * heatPreference;
  // Greenwood sustains growth past the climate band: verdure is a floor under the climate's
  // verdict, while shade still decides who grows under whom.
  return Math.max(climate, f.verdure) * shade;
}

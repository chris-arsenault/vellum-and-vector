import type { PhysicalField } from "./field";
import type { PhysicalArrayName } from "./continuousState";
import type { ChannelBinding } from "./atlasChannels";

export const derivedBindings: ChannelBinding[] = [
  { name: "flow", native: "FlowAccumulation", unit: "cubic-metre/second", scale: 1 },
  {
    name: "drainageElevation",
    native: "DrainageElevations",
    unit: "metre",
    scale: 1 / 1024,
    datum: true,
  },
  { name: "precipitation", native: "Precipitation", unit: "metre/year", scale: 1 },
  { name: "erosion", native: "TotalErosion", unit: "metre", scale: 1 / 1024 },
  { name: "carbonate", native: "Carbonate", unit: "ratio", scale: 1 },
  { name: "seaLevel", native: "SeaLevel", unit: "metre", scale: 1 },
  { name: "seaDatum", native: "SeaDatum", unit: "metre", scale: 1 },
];
/** Derived physical quantities advance with their inputs, before extraction. */
export function updateDerivedFields(map: PhysicalField, changed: Set<PhysicalArrayName>) {
  const precipitation = changed.has("Rainfall") || changed.has("Snowfall");
  const erosion = [
    "CumulativeFluvialErosion",
    "CumulativeGlacialErosion",
    "CumulativeCoastalErosion",
  ].some((name) => changed.has(name as PhysicalArrayName));
  const carbonate =
    changed.has("CrustContinentalFraction") || changed.has("VolcanicConstructionHistory");
  const sea = (map.EffectiveSeaLevel - map.BaseSeaLevel) / 1024,
    datum = map.BaseSeaLevel / 1024;
  const stageChanged = map.SeaLevel[0] !== sea || map.SeaDatum[0] !== datum;
  if (!precipitation && !erosion && !carbonate && !stageChanged) return;
  for (let i = 0; i < map.mesh.count; i++) {
    if (precipitation) map.Precipitation[i] = (map.Rainfall[i] + map.Snowfall[i]) / 1000;
    if (erosion)
      map.TotalErosion[i] =
        map.CumulativeFluvialErosion[i] +
        map.CumulativeGlacialErosion[i] +
        map.CumulativeCoastalErosion[i];
    if (carbonate)
      map.Carbonate[i] =
        (map.CrustContinentalFraction[i] / 1000) *
        (1 - Math.min(1, map.VolcanicConstructionHistory[i] / (1024 * 100)));
    if (stageChanged) {
      map.SeaLevel[i] = sea;
      map.SeaDatum[i] = datum;
    }
  }
  if (precipitation) changed.add("Precipitation");
  if (erosion) changed.add("TotalErosion");
  if (carbonate) changed.add("Carbonate");
  if (stageChanged) {
    changed.add("SeaLevel");
    changed.add("SeaDatum");
  }
}

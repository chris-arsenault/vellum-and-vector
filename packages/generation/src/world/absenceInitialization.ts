import type { GenerationState, MapProcess } from "../process";
import type { ResolvedFeatures } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import type { PhysicalField, PhysicalBufferName as BufferName } from "./field";
import { absentInheritedHistories } from "./inheritedFacts";

/** What a process that did not run would have left, as nothing having happened: not a claim it ran. */
const neutralBuffers: Record<string, BufferName[]> = {
  Impacts: ["ImpactExcavation", "ImpactRimUplift", "ImpactEjectaThickness", "ImpactHeat"],
  VolcanicConstruction: [
    "VolcanicConstructionHistory",
    "VolcanicActivity",
    "MantlePlumeRootStrength",
  ],
  MantlePlumeRoots: ["MantlePlumeRootStrength"],
  GlacialEvolution: ["CumulativeGlacialErosion", "CumulativeGlacialDeposition"],
  CoastalEvolution: [
    "CumulativeCoastalErosion",
    "ExternalCoastalForcing",
    "ExternalCoastalForcingHistory",
  ],
  Floodplains: ["FloodplainIntensity"],
  Deltas: ["DeltaIntensity"],
  Geothermal: ["Geothermal", "GeothermalHistory"],
  OrogenicConstruction: ["OrogenicConstruction"],
  SeaIce: ["SeaIceSuitability"],
  LandIce: ["IceThickness", "MaximumIceThickness", "GroundedIce", "IceBalance"],
  IceFlow: ["IceFlux", "MaximumIceFlux", "MaximumGroundedIceFlux"],
  GlacialMeltwater: ["GlacialMeltwater"],
  OceanCurrents: [
    "OceanCurrentX",
    "OceanCurrentY",
    "OceanCurrentHeat",
    "OceanCurrentStrength",
    "SeaSurfaceAnomaly",
    "Upwelling",
    "WaveExposure",
  ],
  Warmth: ["Warmth"],
  RiverGeometry: ["RiverWidth", "RiverDepth", "RiverChannelStrength", "RiverChannelOrders"],
  Landforms: ["LandformCodes"],
};
export function absenceInitialization(
  features: ResolvedFeatures,
  channels: ReadonlySet<string>
): MapProcess {
  const absent = new Set([
    ...absentInheritedHistories(channels),
    ...physicalFeatureDefinitions.flatMap((feature) =>
      features.selection[feature.id].enabled ? [] : (feature.absent ?? [])
    ),
  ]);
  return {
    contract: {
      id: "atlas.absent-physical",
      version: "1",
      parameters: {},
      requires: ["atlas:workspace"],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
    },
    behavior: {
      kind: "initialize",
      initialize(state) {
        initializeAbsent(state, absent);
      },
    },
    validate: () => [],
  };
}
function initializeAbsent(state: GenerationState, absent: Set<string>) {
  const map = state.physical!.map;
  for (const history of absent) {
    for (const name of neutralBuffers[history] ?? []) map[name].fill(0);
    if (history === "VolcanicConstruction") map.VolcanicLastActiveEpoch.fill(-1);
    if (history === "SeaIce") clearOceanIce(map);
  }
  if (absent.has("Impacts")) map.events = map.events.filter((event) => event.kind !== "impact");
  if (absent.has("VolcanicConstruction"))
    map.events = map.events.filter((event) => event.kind === "impact");
  if (absent.has("Fractures")) map.faults = [];
}
function clearOceanIce(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1) map.IceThickness.set(i, 0);
}

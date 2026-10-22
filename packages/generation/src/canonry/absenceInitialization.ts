import type { GenerationState, MapProcess } from "../process";
import type { ResolvedFeatures } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import type { PhysicalField } from "./field";
import { preparePhysicalChannels } from "./continuousState";

type BufferName = {
  [K in keyof PhysicalField]-?: PhysicalField[K] extends { fill(value: number): unknown } ? K : never;
}[keyof PhysicalField];
/** Explicit neutral histories; these are not claims that the omitted models ran. */
const neutralBuffers: Record<string, BufferName[]> = {
  Impacts: ["ImpactExcavation", "ImpactRimUplift", "ImpactEjectaThickness", "ImpactHeat"],
  VolcanicConstruction: [
    "VolcanicConstructionHistory",
    "VolcanicActivity",
    "MantlePlumeRootStrength",
  ],
  MantlePlumeRoots: ["MantlePlumeRootStrength"],
  GlacialEvolution: ["CumulativeGlacialErosion", "CumulativeGlacialDeposition"],
  GlacialLandforms: [],
  CoastalEvolution: [
    "CumulativeCoastalErosion",
    "ExternalCoastalForcing",
    "ExternalCoastalForcingHistory",
  ],
  Floodplains: ["FloodplainIntensity"],
  Deltas: ["DeltaIntensity"],
  Fractures: [],
  Geothermal: ["Geothermal", "GeothermalHistory"],
  OrogenicConstruction: ["OrogenicConstruction"],
  SedimentTransport: [],
  SeaIce: ["SeaIceSuitability"],
  GlacialRelief: [],
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
  inheritedAbsences: string[],
  provided: string[] = []
): MapProcess {
  const inherited = new Set(provided.map((fact) => `canonry:${fact}`));
  const absent = new Set(
    [
      ...inheritedAbsences.map((fact) => `canonry:${fact}`),
      ...physicalFeatureDefinitions.flatMap((feature) =>
        features.selection[feature.id].enabled
          ? []
          : (feature.absent ?? []).map(({ product }) => product)
      ),
    ].filter((product) => !inherited.has(product))
  );
  return {
    contract: {
      id: "atlas.absent-physical",
      version: "1",
      parameters: {},
      requires: ["canonry:workspace"],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
      initializes: [...absent].map((product) => ({
        product,
        initializer: "atlas.absent-physical",
        retainOnInvalidation: true,
      })),
    },
    behavior: {
      kind: "initialize",
      initialize(state) {
        initializeAbsent(state, absent);
      },
    },
    prepareFields: (state) =>
      preparePhysicalChannels(state.physical!.map, [
        ...[...absent].flatMap((product) => neutralBuffers[product.slice(8)] ?? []),
        ...(absent.has("canonry:SeaIce") ? ["IceThickness" as const] : []),
      ]),
    validate: () => [],
  };
}
function initializeAbsent(state: GenerationState, absent: Set<string>) {
  const map = state.physical!.map;
  for (const product of absent) {
    const fact = product.slice(8);
    for (const name of neutralBuffers[fact] ?? []) map[name].fill(0);
    if (fact === "VolcanicConstruction") map.VolcanicLastActiveEpoch.fill(-1);
    if (fact === "SeaIce") clearOceanIce(map);
  }
  if (absent.has("canonry:Impacts"))
    map.events = map.events.filter((event) => event.kind !== "impact");
  if (absent.has("canonry:VolcanicConstruction"))
    map.events = map.events.filter((event) => event.kind === "impact");
  if (absent.has("canonry:Fractures")) map.faults = [];
}
function clearOceanIce(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) if (map.WaterKindCodes[i] === 1) map.IceThickness[i] = 0;
}

import type { ProductDefinition } from "../productLedger";
import type { GenerationState, MapProcessContext } from "../process";
import type { ProcessBehavior } from "../processTraits";
import { requireThat } from "@atlas/domain";

const definitions: Record<
  string,
  Pick<ProductDefinition, "representation" | "unit" | "composition">
> = {
  Elevation: {
    representation: "field",
    unit: "native-height/1024-metre",
    composition: "shared-state",
  },
  LandscapeHistory: { representation: "history", composition: "shared-state" },
  SedimentSupply: {
    representation: "field",
    unit: "native-height/1024-metre",
    composition: "shared-state",
  },
  SedimentTransport: {
    representation: "history",
    unit: "cubic-metre",
    composition: "shared-state",
  },
  GlacialEvolution: {
    representation: "history",
    unit: "native-height/1024-metre",
    composition: "shared-state",
  },
  CoastalEvolution: {
    representation: "history",
    unit: "native-height/1024-metre",
    composition: "shared-state",
  },
  Impacts: { representation: "history", composition: "shared-state" },
  VolcanicConstruction: { representation: "history", composition: "shared-state" },
  MantlePlumeRoots: { representation: "history", composition: "shared-state" },
  OrogenicConstruction: { representation: "history", composition: "shared-state" },
  EpochHistory: { representation: "history", composition: "shared-state" },
  Temperature: {
    representation: "field",
    unit: "native-climate/10-celsius",
    composition: "exclusive",
  },
  Precipitation: { representation: "field", unit: "millimetre/year", composition: "exclusive" },
  Runoff: { representation: "field", unit: "millimetre/year", composition: "exclusive" },
  GlacialMeltwater: { representation: "field", unit: "millimetre/year", composition: "exclusive" },
  LandIce: { representation: "field", unit: "metre", composition: "shared-state" },
  LakeState: { representation: "field", composition: "shared-state" },
  IceFlow: { representation: "field", unit: "cubic-metre/year", composition: "shared-state" },
  OceanDistance: { representation: "field", unit: "metre", composition: "exclusive" },
};

/** Native categorical/topology products use typed arrays in the shared map. */
export function physicalProduct(id: string): ProductDefinition {
  return {
    id: `canonry:${id}`,
    lifetime: "run",
    scope: "located-space",
    representation: "workspace",
    composition: "exclusive",
    ...definitions[id],
  };
}

const materialTransformations = new Set([
  "mass-wasting",
  "post-fluvial-mass-wasting",
  "marine-sedimentation",
  "ancestral-fluvial-erosion",
  "sediment-transport",
  "glacial-erosion",
  "glacial-deposition",
  "external-coastal-forcing",
  "coastal-erosion-and-deposition",
]);
type Operation = (state: GenerationState, context: MapProcessContext) => void | Promise<void>;
/** Material traits check the common budget even when several mechanisms supply it. */
export function nativeBehavior(name: string, operation: Operation): ProcessBehavior {
  return materialTransformations.has(name)
    ? { kind: "material-transformation", transform: operation, balance: materialBudget }
    : { kind: "model-pass", applyPass: operation };
}
function materialBudget(state: GenerationState) {
  const map = state.physical!;
  const {
    SedimentProducedTotal: produced,
    SedimentDepositedTotal: deposited,
    SedimentExportedTotal: exported,
  } = map.map;
  requireThat(
    [produced, deposited, exported].every((value) => Number.isFinite(value) && value >= 0) &&
      deposited + exported <= produced + Math.max(0.001, produced * 1e-9),
    "material_budget",
    "Material transformations retain the shared sediment budget."
  );
}

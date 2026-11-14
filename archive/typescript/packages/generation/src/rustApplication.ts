import {
  cloneSnapshot,
  type FieldGeography,
  type NumericalResource,
  type Grid,
  type World,
} from "@atlas/domain";
import { preparePublicationLayers } from "./publication";
import type { GenerationState, GenerationDiagnostic, EpochHistory } from "./process";
import type { prepareRustGeneration } from "./rustRequest";
import { atlasGenerationModules } from "./atlasModules";

type Prepared = ReturnType<typeof prepareRustGeneration>;
type Records = Required<
  Pick<GenerationState, "features" | "sourceFeatures" | "networks" | "sourceNetworks">
>;
export interface RustCompleted {
  surfaceId: string;
  surfaceResourceId: string;
  fields: { fieldId: string; resourceId: string; channels: string[] }[];
  resources: NumericalResource[];
  geography: FieldGeography[];
  history: EpochHistory[];
  causes: NonNullable<GenerationState["causes"]>;
  entities: World["entities"];
  landmarks: World["landmarks"];
  drainage: NonNullable<World["drainage"]>[string] | null;
}

/** Preserve the existing canonical/procedural record split while Rust owns numerical execution. */
export function rustApplication(prepared: Prepared, records: Records) {
  const diagnostics: GenerationDiagnostic[] = [];
  const domain = cloneSnapshot(prepared.source),
    state = { domain, ...records };
  domain.world.features = {};
  domain.world.networkNodes = {};
  domain.world.networkReaches = {};
  preparePublicationLayers(domain, prepared.publications, domain.scope.areaId, records.features);
  return {
    state,
    diagnostic: (diagnostic: GenerationDiagnostic) => diagnostics.push(diagnostic),
    completed(result: RustCompleted, surface: Grid): GenerationState {
      domain.world.entities = result.entities;
      const landmarks = new Map(domain.world.landmarks.map((landmark) => [landmark.id, landmark]));
      for (const landmark of result.landmarks) landmarks.set(landmark.id, landmark);
      domain.world.landmarks = [...landmarks.values()];
      if (result.drainage)
        domain.world.drainage = {
          ...domain.world.drainage,
          [domain.scope.areaId]: result.drainage,
        };
      else delete domain.world.drainage?.[domain.scope.areaId];
      return {
        ...state,
        surface,
        facts: new Set(Object.keys(surface.channels)),
        history: result.history,
        causes: result.causes,
        diagnostics,
        publications: atlasGenerationModules.publications(prepared.input, domain.world),
      };
    },
  };
}

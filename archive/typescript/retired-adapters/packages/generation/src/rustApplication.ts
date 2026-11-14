import type {
  DomainSnapshot,
  FieldGeography,
  FieldChannelName,
  NumericalResource,
  Grid,
  World,
} from "@atlas/domain";
import type { GenerationState, GenerationDiagnostic, EpochHistory } from "./process";
import type { prepareRustGeneration } from "./rustRequest";

type Records = Required<
  Pick<GenerationState, "features" | "sourceFeatures" | "networks" | "sourceNetworks">
>;
export interface RustCompleted {
  snapshot: Omit<DomainSnapshot, "numerical">;
  surfaceId: string;
  surfaceResourceId: string;
  fields: { fieldId: string; resourceId: string; channels: FieldChannelName[] }[];
  resources: NumericalResource[];
  geography: FieldGeography[];
  history: EpochHistory[];
  causes: NonNullable<GenerationState["causes"]>;
  entities: World["entities"];
  landmarks: World["landmarks"];
  drainage: NonNullable<World["drainage"]>[string] | null;
}
/** Retain local resource handles for the existing storage facade; all domain metadata comes from Rust. */
export function rustApplication(
  prepared: ReturnType<typeof prepareRustGeneration>,
  records: Records
) {
  const diagnostics: GenerationDiagnostic[] = [];
  return {
    diagnostic: (diagnostic: GenerationDiagnostic) => diagnostics.push(diagnostic),
    completed(result: RustCompleted, surface: Grid): GenerationState {
      const numerical = { ...prepared.source.numerical };
      for (const field of result.fields) {
        numerical[field.fieldId] = {
          ...surface,
          id: field.resourceId,
          channels: Object.fromEntries(
            field.channels.map((name) => [name, surface.channels[name]])
          ),
          units: Object.fromEntries(field.channels.map((name) => [name, surface.units[name]])),
          quantities: Object.fromEntries(
            field.channels.map((name) => [name, surface.quantities?.[name]])
          ),
          overlays: numerical[field.fieldId]?.overlays,
          materialCargo: field.channels.includes("RockLayerKind0")
            ? surface.materialCargo
            : undefined,
        };
      }
      return {
        domain: { ...result.snapshot, numerical },
        ...records,
        surface,
        facts: new Set(Object.keys(surface.channels)),
        history: result.history,
        causes: result.causes,
        diagnostics,
      };
    },
  };
}

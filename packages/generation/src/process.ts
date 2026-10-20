import type {
  Diagnostic,
  DomainSnapshot,
  Grid,
  ParameterDefinitions,
  ParameterValues,
  SpatialScope,
} from "@atlas/domain";
import { requireThat, sameValue } from "@atlas/domain";
import type { ProcessBehavior } from "./processTraits";
import type {
  EmptyProductInitialization,
  ProductDefinition,
  ProductLedger,
  ProductRequirement,
} from "./productLedger";

export interface GenerationState {
  physical?: import("./canonry/atlasWorkspace").AtlasPhysicalWorkspace;
  domain: DomainSnapshot;
  surface: Grid;
  facts: Set<string>;
  history: EpochHistory[];
  causes?: GenerationCause[];
  publications?: import("./publication").PublicationDefinition[];
}
export interface FieldSummary {
  unit: string;
  minimum: number;
  maximum: number;
  mean: number;
}
export type GenerationCause =
  | { kind: "climate"; process: string; fields: Record<string, FieldSummary> }
  | {
      kind: "material";
      process: string;
      eroded: number;
      deposited: number;
      exported: number;
      unit: "cubic-metre";
    }
  | {
      kind: "drainage";
      process: string;
      runoff: number;
      outflow: number;
      unit: "cubic-metre/second";
    }
  | {
      kind: "ice";
      process: string;
      accumulation: number;
      meltwater: number;
      remaining: number;
      unit: "cubic-metre";
    }
  | {
      kind: "magic";
      process: string;
      sourceId: string;
      activity: number;
      forcing: FieldSummary;
      stored: FieldSummary;
    }
  | { kind: "domain"; process: string; subjects: string[]; description: string };
export interface EpochHistory {
  path: string[];
  ancestry: GenerationEpoch[];
  causes: GenerationCause[];
}
export interface GenerationEpoch {
  id: string;
  duration: number;
  parentEpoch: string | null;
  variables: ParameterValues;
}
export interface MapProcessContract {
  id: string;
  version: string;
  parameters: ParameterDefinitions;
  requires: string[];
  produces: string[];
  invalidates: string[];
  products?: ProductDefinition[];
  inputs?: ProductRequirement[];
  initializes?: EmptyProductInitialization[];
  reconciliation?: ProcessReconciliation;
  // Private numerical steps publish no GIS changes until an explicit projection.
  workspaceOnly?: boolean;
}
export interface MapProcessContext {
  scope: SpatialScope;
  invocation: string[];
  parameters: ParameterValues;
  inputs?: ParameterValues;
  products?: ProductLedger;
  reconcile?(): Promise<void>;
  epochs: GenerationEpoch[];
  epochIndices: number[];
  causes: readonly GenerationCause[];
  recordCause(cause: GenerationCause): void;
  random(persistent?: boolean): number;
  cancelled(): boolean;
  progress(fraction: number, message: string): void;
}
export interface MapProcess {
  contract: MapProcessContract;
  behavior?: ProcessBehavior;
  apply?(state: GenerationState, context: MapProcessContext): void | Promise<void>;
  validate(state: GenerationState, context: MapProcessContext): Diagnostic[];
}
export type ProcessSequence = (ProcessInvocation | EpochSequence)[];
/** A conditional repair of transferred state; both outcomes retain the guarantees. */
export interface ProcessReconciliation {
  invalidates: string[];
  sequence: ProcessSequence;
  guarantees: string[];
}
export interface ProcessInvocation {
  kind: "process";
  id: string;
  process: string;
  feature?: string;
  version: string;
  parameters?: ParameterValues;
  when?: { variable: string; equals: string | number | boolean | null };
}
export interface EpochSequence {
  kind: "epochs";
  id: string;
  epochs: GenerationEpoch[];
  // The profile identifies facts whose forcing/context changes in this loop.
  resetFacts: string[];
  body: ProcessSequence;
}
export interface ProcessConfiguration {
  id: string;
  version: number;
  parameters: ParameterValues;
  sequence: ProcessSequence;
  inputs?: ParameterValues;
}
export interface CompletedBoundary {
  configurationHash: string;
  kind: "epoch" | "final";
  ancestry: GenerationEpoch[];
  state: GenerationState;
}

export class MapProcessRegistry {
  private readonly entries = new Map<string, MapProcess>();
  contracts(): MapProcessContract[] {
    return Array.from(this.entries.values(), (process) => process.contract);
  }
  productDefinitions(): ProductDefinition[] {
    return this.contracts().flatMap((contract) => contract.products ?? []);
  }
  reconciliations(): Record<string, ProcessReconciliation> {
    return Object.fromEntries(
      this.contracts().flatMap((contract) =>
        contract.reconciliation
          ? [[`${contract.id}@${contract.version}`, structuredClone(contract.reconciliation)]]
          : []
      )
    );
  }
  register(process: MapProcess): this {
    const key = `${process.contract.id}@${process.contract.version}`;
    requireThat(!this.entries.has(key), "process_identity", `Register ${key} once.`);
    requireThat(
      process.behavior || process.apply,
      "process_behavior",
      `Bind an operation for ${key}.`
    );
    this.entries.set(key, process);
    return this;
  }
  get(id: string, version: string): MapProcess {
    const process = this.entries.get(`${id}@${version}`);
    requireThat(process, "unknown_process", `Process ${id}@${version} is unavailable.`);
    return process;
  }
}

export function verifyReconciliationBindings(
  configuration: ProcessConfiguration,
  registry: MapProcessRegistry
) {
  requireThat(
    sameValue(configuration.inputs?.reconciliations ?? {}, registry.reconciliations()),
    "reconciliation_binding",
    "Execute the reconciliation plans recorded in the reviewed recipe."
  );
}

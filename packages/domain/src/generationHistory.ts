import type { ParameterValues } from "./schemas";

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
export interface GenerationEpoch {
  id: string;
  duration: number;
  parentEpoch: string | null;
  variables: ParameterValues;
}
export interface EpochHistory {
  path: string[];
  ancestry: GenerationEpoch[];
  causes: GenerationCause[];
}
export interface CompletedGenerationHistory {
  runId: string;
  areaId: string;
  entries: EpochHistory[];
}

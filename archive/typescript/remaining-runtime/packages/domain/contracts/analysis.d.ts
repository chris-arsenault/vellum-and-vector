import { z } from "zod";
import type { DomainSnapshot } from "./operations";
import type { Diagnostic } from "./errors";
export declare const analysisSchema: z.ZodObject<
  {
    scope: z.ZodObject<
      {
        footprint: z.ZodType<
          import("geojson").Geometry,
          unknown,
          z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
        >;
        crsId: z.ZodString;
        revision: z.ZodNumber;
        time: z.ZodString;
        resolution: z.ZodNullable<z.ZodNumber>;
        worldId: z.ZodUUID;
        areaId: z.ZodUUID;
        spaceId: z.ZodUUID;
      },
      z.core.$strip
    >;
    operation: z.ZodEnum<{
      causes: "causes";
      routeFeasibility: "routeFeasibility";
      hydrologyFeasibility: "hydrologyFeasibility";
      dependencies: "dependencies";
      boundaryConditions: "boundaryConditions";
    }>;
    geometry: z.ZodOptional<
      z.ZodType<
        import("geojson").Geometry,
        unknown,
        z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
      >
    >;
    featureId: z.ZodOptional<z.ZodUUID>;
    maximumGrade: z.ZodDefault<z.ZodNumber>;
  },
  z.core.$strip
>;
export type AnalysisRequest = z.infer<typeof analysisSchema>;
export declare function analyze(
  snapshot: DomainSnapshot,
  request: AnalysisRequest
):
  | {
      areaId: string;
      boundary: {
        version: number;
        parentId: string;
        parentVersion: number;
        crossings: import("./model").Crossing[];
        samples: import("./boundaryContracts").FieldSample[];
        epochs: import("./model").Epoch[];
        rings?: import("./boundaryContracts").FieldSample[][] | null;
        waterFluxes?: import("./model").WaterFlux[] | null;
        history?: import("./boundaryContracts").BoundaryHistory[];
      } | null;
      traits: import("./model").Trait[];
    }[]
  | {
      id: string;
      relations: import("./model").Relation[];
    }[]
  | {
      featureId: string | undefined;
      provenance: {
        generationId: string | null;
        causes: string[];
        actor: string;
      } | null;
      resources: {
        id: string;
        facts: string[];
        lineage: string[];
      }[];
    }
  | {
      geometry: import("geojson").Geometry;
      lengthMetres: number;
      maximumGrade: number | null;
      samples: {
        point: {
          x: number;
          y: number;
          z: number;
        };
        elevation: number;
        flow: number;
      }[][];
      diagnostics: AnalysisDiagnostic[];
    };
type AnalysisDiagnostic = Pick<Diagnostic, "code" | "severity" | "message">;
export {};

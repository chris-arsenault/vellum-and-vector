import { z } from "zod";
import { durableScopeSchema, geometrySchema } from "./schemas";
import type { DomainSnapshot } from "./operations";
import { requireThat } from "./errors";
import { spatial } from "./spatial";
import { composeFeature } from "./composition";
import { lineParts } from "./lineStations";
import { sampleFields } from "./boundaryContracts";
import type { Diagnostic } from "./errors";
import type { AtlasFeature } from "./model";

export const analysisSchema = z.object({
  scope: durableScopeSchema,
  operation: z.enum([
    "routeFeasibility",
    "hydrologyFeasibility",
    "dependencies",
    "causes",
    "boundaryConditions",
  ]),
  geometry: geometrySchema.optional(),
  featureId: z.uuid().optional(),
  maximumGrade: z.number().finite().nonnegative().default(0.15),
});
export type AnalysisRequest = z.infer<typeof analysisSchema>;
export function analyze(snapshot: DomainSnapshot, request: AnalysisRequest) {
  const feature = request.featureId ? snapshot.world.features[request.featureId] : undefined;
  requireThat(
    !request.featureId || feature,
    "missing_feature",
    "Select a feature visible in this scope."
  );
  switch (request.operation) {
    case "boundaryConditions":
      return Object.values(snapshot.world.areas).map((a) => ({
        areaId: a.id,
        boundary: a.boundary,
        traits: a.traits,
      }));
    case "dependencies":
      return Object.values(snapshot.world.features)
        .filter(
          (f) =>
            f.id === request.featureId || f.relations.some((r) => r.targetId === request.featureId)
        )
        .map((f) => ({ id: f.id, relations: f.relations }));
    case "causes":
      return causes(snapshot, feature);
    default: {
      const geometry = request.geometry ?? (feature && composeFeature(snapshot.world, feature));
      requireThat(
        geometry && spatial.covers(request.scope.footprint, geometry),
        "analysis_extent",
        "Provide a route inside the selected analysis extent."
      );
      return analyzeRoute(snapshot, request, geometry);
    }
  }
}
function causes(snapshot: DomainSnapshot, feature: AtlasFeature | undefined) {
  return {
    featureId: feature?.id,
    provenance: feature
      ? { generationId: feature.generationId, causes: feature.causes, actor: feature.actor }
      : null,
    resources: snapshot.resources.map((r) => ({ id: r.id, facts: r.facts, lineage: r.lineage })),
  };
}
type RouteSample = {
  point: { x: number; y: number; z: number };
  elevation: number | null;
  flow: number | null;
};
type AnalysisDiagnostic = Pick<Diagnostic, "code" | "severity" | "message">;
function segmentGrade(a: RouteSample, b: RouteSample, distance: number) {
  if (a.elevation === null || b.elevation === null) return null;
  const delta = b.elevation - a.elevation;
  return { delta, grade: distance > 0 ? Math.abs(delta) / distance : delta === 0 ? 0 : Infinity };
}
function routeDiagnostic(
  request: AnalysisRequest,
  segment: ReturnType<typeof segmentGrade>,
  precision: number
): AnalysisDiagnostic | null {
  if (segment === null)
    return {
      code: "unknown_elevation",
      severity: "warning",
      message: "Sampled terrain is unavailable along part of this route.",
    };
  if (request.operation === "hydrologyFeasibility" && segment.delta > precision)
    return {
      code: "uphill_waterway",
      severity: "error",
      message: "The directed route rises; validate an explicit causal lift before authoring it.",
    };
  if (request.operation === "routeFeasibility" && segment.grade > request.maximumGrade)
    return {
      code: "steep_route",
      severity: "warning",
      message: "The route exceeds the selected grade preference.",
    };
  return null;
}
function analyzeRoute(
  snapshot: DomainSnapshot,
  request: AnalysisRequest,
  geometry: import("geojson").Geometry
) {
  const diagnostics: AnalysisDiagnostic[] = [];
  const parts = lineParts(geometry).map((line) =>
    line.map((p) => {
      const point = { x: p[0], y: p[1], z: p[2] ?? 0 },
        facts = sampleFields(snapshot, point);
      return { point, elevation: p[2] ?? facts.elevation ?? null, flow: facts.flow ?? null };
    })
  );
  let length = 0,
    maximumGrade = 0;
  for (const line of parts)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
      length += distance;
      const segment = segmentGrade(a, b, distance),
        diagnosis = routeDiagnostic(request, segment, snapshot.world.reference.precision ?? 1e-6);
      maximumGrade = Math.max(maximumGrade, segment?.grade ?? 0);
      if (diagnosis) diagnostics.push(diagnosis);
    }
  return {
    geometry,
    lengthMetres: length,
    maximumGrade: Number.isFinite(maximumGrade) ? maximumGrade : null,
    samples: parts,
    diagnostics,
  };
}

import {
  analysisSchema,
  analyze,
  readRequirementsSchema,
  requireThat,
  type AnalysisRequest,
} from "@atlas/domain";
import { Database, ownedVersion } from "./dal/database";
import { validateCommittedScope } from "./dal/scopedReads";
import { readProjection } from "./dal/projections";
import { readContextFields } from "./dal/fieldBindings";
import { ancestorIds } from "./dal/areaReader";

export class AnalysisService {
  constructor(private readonly database: Database) {}
  async analyze(world: string, owner: string, request: AnalysisRequest) {
    const input = analysisSchema.parse(request),
      scope = input.scope;
    return this.database.transaction(async (sql) => {
      const version = await ownedVersion(sql, world, owner);
      requireThat(
        scope.worldId === world && scope.revision <= version,
        "invalid_revision",
        "Select an available revision in this world."
      );
      await validateCommittedScope(sql, scope);
      const fields = await readContextFields(
        sql,
        scope,
        await ancestorIds(sql, world, scope.revision, scope.areaId)
      );
      const reads = readRequirementsSchema.parse({
        scope,
        objects: input.featureId ? [{ kind: "feature", ids: [input.featureId] }] : [],
        completeRepresentations: input.featureId ? [input.featureId] : [],
        channels: fields.map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
        constraints: {
          intersectingAreas: true,
          descendantsOf: [],
          boundaryFeatures: input.featureId ? [input.featureId] : [],
        },
      });
      return analyze(await readProjection(sql, reads), input);
    }, true);
  }
}

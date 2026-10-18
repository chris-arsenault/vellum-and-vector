import { analysisSchema } from "@atlas/domain";
import { AnalysisService } from "../analysisService";
import { ok, type RouteServices, type Route } from "./routes";
import { worldPath } from "./ownedReads";

export function analysisRoutes({ database }: RouteServices): Route[] {
  const service = new AnalysisService(database);
  return [
    {
      method: "POST",
      path: /^\/api\/worlds\/([^/]+)\/analyze$/,
      async handle(request, context, match) {
        return ok(
          await service.analyze(
            worldPath(match),
            context.principal.owner,
            analysisSchema.parse(request.body)
          )
        );
      },
    },
  ];
}

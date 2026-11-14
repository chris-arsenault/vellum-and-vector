import { type Bounds, type World } from "@atlas/domain";
import { atlasWorkspace, readEditorWorld, workspaceScope } from "./atlasWorkspace";
import type { AnalysisInput } from "./spatialAnalysis";

export async function readWorkspaceFeature(id: string, featureId: string, areaId: string) {
  const world = await readEditorWorld(id);
  return (await atlasWorkspace()).readFeature(workspaceScope(world, areaId), featureId);
}
export async function readWorkspaceScene(world: World, areaId: string, extent: Bounds) {
  const workspace = await atlasWorkspace(),
    features = [];
  let after: string | null = null;
  do {
    const page = await workspace.readFeatures({
      scope: workspaceScope(world, areaId),
      extent,
      layers: [],
      after,
      limit: 128,
      predicate: "intersects",
      geometry: null,
    });
    features.push(...page.records.map((record) => record.feature));
    after = page.next;
  } while (after);
  return features;
}
export async function analyzeWorkspaceArea(id: string, input: AnalysisInput) {
  return (await atlasWorkspace()).analyze(id, input);
}
export async function exportWorkspaceWorld(id: string, areaId?: string) {
  return (await atlasWorkspace()).exportWorld(id, areaId);
}

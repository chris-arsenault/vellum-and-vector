import type { BrowserWorkspace } from "@atlas/storage-browser";
import { openBlockCache } from "@atlas/storage-browser";
import { analyzeSnapshot, type AnalysisInput } from "./spatialAnalysis";
import { analysisRequirements } from "./analysisRequirements";
import { WorkspaceFields } from "./workspaceFields";

export async function workspaceAnalysis(
  current: BrowserWorkspace,
  worldId: string,
  input: AnalysisInput
) {
  const requirements = analysisRequirements(await current.catalog.readEditor(worldId), input);
  const source = await current.catalog.readAuthoring(requirements);
  if (!requirements.channels.length) return analyzeSnapshot(source, input);
  const working = await openBlockCache(`analysis_${crypto.randomUUID()}`);
  const fields = new WorkspaceFields(current.catalog, current.resources, working.cache);
  try {
    await fields.read(source, requirements);
    return analyzeSnapshot(source, input);
  } finally {
    await fields.close();
    await working.close();
  }
}

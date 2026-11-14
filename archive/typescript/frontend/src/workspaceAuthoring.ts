import { requireThat, type Command, type Proposal } from "@atlas/domain";
import { atlasWorkspace, readEditorWorld, rememberWorld, workspaceScope } from "./atlasWorkspace";
import { listTemplates } from "./atlasTemplates";
import { listJobs, startGeneration } from "./generationJobs";

async function execute(id: string, command: Command, preview: boolean) {
  const workspace = await atlasWorkspace(),
    world = await workspace.readEditor(id);
  const areaId = String(
    command.data.areaId ??
      command.data.parentId ??
      Object.values(world.areas).find((area) => !area.parentId)!.id
  );
  const template = listTemplates().find((item) => item.id === command.data.templateId);
  const result = await workspace.executeCommand({
    scope: workspaceScope(world, areaId),
    command,
    template,
    preview,
  });
  return { world, result, template };
}
export async function previewWorkspaceCommand(id: string, command: Command): Promise<Proposal> {
  const { world, result } = await execute(id, command, true);
  const features = Object.fromEntries(
    result.preview.flatMap((write) =>
      write.kind === "feature" ? [[write.value.id, write.value]] : []
    )
  );
  return { candidate: { ...world, features }, impact: result.impact };
}
export async function commitWorkspaceCommand(id: string, command: Command): Promise<Proposal> {
  const template = listTemplates().find((item) => item.id === command.data.templateId);
  requireThat(
    !template?.recipe || !listJobs(id).some((job) => job.status === "running"),
    "generation_running",
    "Finish or cancel generation before placing a generation recipe."
  );
  const { result } = await execute(id, command, false);
  const candidate = await readEditorWorld(id);
  rememberWorld(candidate, result.change);
  if (command.kind === "instantiateTemplate" && template?.recipe) {
    const placed = Object.values(candidate.areas).find(
      (area) =>
        area.templateId === template.id &&
        result.change?.records.some((r) => r.kind === "area" && r.id === area.id)
    );
    requireThat(placed, "template_area", "The placed template needs a located area.");
    await startGeneration(id, {
      ...template.recipe,
      areaId: placed.id,
      expectedVersion: candidate.version,
      operationId: crypto.randomUUID(),
    });
  }
  return { candidate, impact: result.impact };
}

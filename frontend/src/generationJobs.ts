import { requireThat, type World, type Diagnostic, type Grid } from "@atlas/domain";
import { atlasParametersSchema, type AtlasGenerationInput } from "@atlas/generation";
import { changed } from "./workspaceEvents";
import { atlasWorkspace, readEditorWorld, rememberWorld } from "./atlasWorkspace";
import type { GenerationWorkspaceMessage } from "./generationWorkspaceProtocol";

export { generationSnapshot } from "@atlas/generation";
interface GenerationJob {
  id: string;
  worldId: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  startedAt: number;
  diagnostics?: Diagnostic[];
  partial?: boolean;
}
interface RunningJob {
  job: GenerationJob;
  worker: Worker;
  input: AtlasGenerationInput;
  preview?: { grid: Grid; label: string };
}
const jobs: GenerationJob[] = [],
  running = new Map<string, RunningJob>();
const preparing = new Set<string>();
export function listJobs(id: string) {
  return jobs.filter((job) => job.worldId === id).map((job) => ({ ...job }));
}
export function clearGenerationJobs(worldId: string) {
  requireThat(
    !runningFor(worldId) && !preparing.has(worldId),
    "generation_running",
    "Cancel or finish generation before opening a saved map."
  );
  for (let index = jobs.length - 1; index >= 0; index--)
    if (jobs[index].worldId === worldId) jobs.splice(index, 1);
  changed("jobs");
}
function runningFor(worldId: string) {
  return [...running.values()].find((active) => active.job.worldId === worldId);
}
export async function startGeneration(
  id: string,
  input: AtlasGenerationInput & { expectedVersion: number; operationId: string }
) {
  requireThat(
    !preparing.has(id) && !runningFor(id),
    "generation_running",
    "Cancel or finish this world's current generation first."
  );
  preparing.add(id);
  try {
    return await prepareGeneration(id, input);
  } finally {
    preparing.delete(id);
  }
}
async function prepareGeneration(
  id: string,
  input: AtlasGenerationInput & { expectedVersion: number; operationId: string }
) {
  const world = await readEditorWorld(id);
  requireThat(
    world.version === input.expectedVersion,
    "stale_version",
    "Review the current world before generating."
  );
  requireThat(
    !runningFor(id),
    "generation_running",
    "Cancel or finish this world's current generation first."
  );
  requireThat(input.domains.length, "generation_domains", "Select at least one generation domain.");
  input = {
    ...input,
    parameters: atlasParametersSchema.parse(
      input.parameters ?? inheritedGeneration(world, input.areaId)?.parameters ?? {}
    ),
  };
  const workspace = await atlasWorkspace();
  const prepared = await workspace.generationSetup(id, input);
  requireThat(
    !prepared.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    "generation_configuration",
    prepared.diagnostics.map((diagnostic) => diagnostic.message).join("\n")
  );
  input = { ...input, ...prepared.input };
  const worker = new Worker(new URL("./generation.worker.ts", import.meta.url), { type: "module" });
  const job: GenerationJob = {
    id: input.operationId,
    worldId: id,
    status: "running",
    stage: "Preparing geography",
    progress: 0,
    error: null,
    startedAt: Date.now(),
  };
  const channel = new MessageChannel();
  try {
    await workspace.connect(channel.port1);
  } catch (error) {
    worker.terminate();
    channel.port2.close();
    throw error;
  }
  jobs.unshift(job);
  appendDiagnostics(job, prepared.diagnostics);
  running.set(job.id, { job, worker, input });
  let pending = Promise.resolve();
  worker.onmessage = (event: MessageEvent<GenerationWorkspaceMessage>) => {
    pending = pending
      .then(() => receive(job.id, event.data))
      .catch((error: unknown) =>
        finish(job.id, "failed", error instanceof Error ? error.message : String(error))
      );
  };
  worker.onerror = (event) => finish(job.id, "failed", event.message);
  worker.onmessageerror = () => finish(job.id, "failed", "Could not read generation output.");
  worker.postMessage(
    {
      worldId: id,
      input,
      expectedVersion: input.expectedVersion,
      operationId: job.id,
      port: channel.port2,
    },
    [channel.port2]
  );
  changed("jobs");
  return { ...job };
}
export function inheritedGeneration(
  world: World,
  areaId: string
): World["generations"][number] | undefined {
  for (let current: string | null = areaId; current; current = world.areas[current].parentId) {
    const previous = world.generations
      .filter((run) => run.areaId === current && run.domains.includes("physical"))
      .at(-1);
    if (previous) return previous;
  }
  return undefined;
}
export function generationPreviewFor(worldId: string, areaId: string) {
  const active = runningFor(worldId);
  return active?.input.areaId === areaId ? (active.preview ?? null) : null;
}
async function receive(id: string, message: GenerationWorkspaceMessage) {
  const active = running.get(id);
  if (!active) return;
  switch (message.kind) {
    case "diagnostic":
      appendDiagnostics(active.job, [message.diagnostic]);
      break;
    case "progress":
      active.job.stage = progressLabel(message);
      active.job.progress = message.fraction;
      break;
    case "preview":
      active.preview = { grid: message.grid, label: message.label };
      break;
    case "published":
      active.job.partial = message.partial;
      rememberWorld(await readEditorWorld(active.job.worldId), message.change);
      break;
    case "completed":
      active.job.partial = false;
      finish(id, "completed");
      return;
    case "cancelled":
      finish(id, "cancelled");
      return;
    case "failed":
      appendDiagnostics(active.job, message.diagnostics ?? []);
      finish(id, "failed", message.error);
      return;
  }
  changed("jobs");
}
function progressLabel(message: Extract<GenerationWorkspaceMessage, { kind: "progress" }>) {
  return [...message.path.slice(0, -1), message.message].join(" · ");
}
function appendDiagnostics(job: GenerationJob, diagnostics: Diagnostic[]) {
  job.diagnostics = [
    ...new Map(
      [...(job.diagnostics ?? []), ...diagnostics].map((entry) => [JSON.stringify(entry), entry])
    ).values(),
  ];
}
function finish(id: string, status: string, error: string | null = null) {
  const active = running.get(id);
  if (!active) return;
  active.worker.terminate();
  running.delete(id);
  Object.assign(active.job, {
    status,
    error,
    stage: status === "completed" ? "Geography ready" : `${status}: ${active.job.stage}`,
    progress: status === "completed" ? 1 : active.job.progress,
  });
  changed("jobs");
}
export function cancelGeneration(id: string) {
  const active = running.get(id);
  if (!active) return;
  active.job.stage = "Cancelling generation";
  active.worker.postMessage({ kind: "cancel" });
  changed("jobs");
}

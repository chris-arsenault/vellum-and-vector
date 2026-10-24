import { requireThat, type DomainSnapshot, type World, type Diagnostic } from "@atlas/domain";
import {
  atlasParametersSchema,
  prepareAtlasGeneration,
  type AtlasGenerationInput,
} from "@atlas/generation";
import { session, changed, publish, worldScope } from "./atlasState";
import { GenerationReceiver, type GenerationMessage } from "./generationTransport";
import type { Grid } from "@atlas/domain";

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
  expectedVersion: number;
  input: AtlasGenerationInput;
  original: DomainSnapshot;
  initial: boolean;
  delivery?: GenerationReceiver;
  preview?: { grid: Grid; label: string };
}
const jobs: GenerationJob[] = [];
const running = new Map<string, RunningJob>();
export function listJobs(id: string) {
  return jobs.filter((j) => j.worldId === id).map((j) => ({ ...j }));
}
export function clearGenerationJobs(worldId: string) {
  requireThat(
    !jobs.some((job) => job.worldId === worldId && job.status === "running"),
    "generation_running",
    "Cancel or finish this world's generation before opening its saved map."
  );
  for (let index = jobs.length - 1; index >= 0; index--)
    if (jobs[index].worldId === worldId) jobs.splice(index, 1);
  changed("jobs");
}

export function startGeneration(
  id: string,
  input: AtlasGenerationInput & { expectedVersion: number; operationId: string }
) {
  const snapshot = session(id).snapshot;
  input = {
    ...input,
    parameters: atlasParametersSchema.parse(
      input.parameters ?? inheritedGeneration(snapshot.world, input.areaId)?.parameters ?? {}
    ),
  };
  const prepared = prepareAtlasGeneration(snapshot, input);
  const errors = prepared.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  requireThat(
    !errors.length,
    "generation_configuration",
    errors.map((item) => item.message).join("\n")
  );
  input = { ...input, ...prepared.input };
  requireThat(
    snapshot.world.version === input.expectedVersion,
    "stale_version",
    "Review the current world before generating."
  );
  requireThat(
    !jobs.some((j) => j.worldId === id && j.status === "running"),
    "generation_running",
    "Cancel or finish this world's current generation first."
  );
  requireThat(input.domains.length, "generation_domains", "Select at least one generation domain.");
  const worker = new Worker(new URL("./generation.worker.ts", import.meta.url), { type: "module" });
  const job: GenerationJob = {
    id: input.operationId,
    worldId: id,
    status: "running",
    stage: "Preparing geography",
    progress: 0,
    error: null,
    startedAt: Date.now(),
    diagnostics: prepared.diagnostics,
  };
  logProgress(
    job,
    `Preparing ${input.quality} geography; seed ${input.seed}; ${input.domains.join(", ")}`,
    0
  );
  console.log(`[atlas generation ${job.id}] Inputs`, input);
  jobs.unshift(job);
  running.set(job.id, {
    job,
    worker,
    expectedVersion: input.expectedVersion,
    input,
    original: snapshot,
    initial:
      snapshot.world.generations.length === 0 && !snapshot.world.areas[input.areaId].parentId,
  });
  worker.onmessage = (event: MessageEvent<GenerationMessage>) => receive(job.id, event.data);
  worker.onerror = (event) => finish(job.id, "failed", event.message);
  worker.onmessageerror = () =>
    finish(job.id, "failed", "Could not read the generation worker's result.");
  worker.postMessage({
    snapshot: { ...snapshot, scope: worldScope(snapshot.world, input.areaId) },
    input,
    operationId: job.id,
  });
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
  const active = [...running.values()].find(
    (active) => active.job.worldId === worldId && active.input.areaId === areaId
  );
  return active?.preview ?? null;
}
function receive(id: string, message: GenerationMessage) {
  const active = running.get(id);
  if (!active) return;
  if (message.kind === "diagnostic") {
    appendDiagnostics(active.job, [message.diagnostic]);
    changed("jobs");
    return;
  }
  if (message.kind === "progress") {
    logProgress(
      active.job,
      `${message.path.slice(0, -1).join(" / ")}${message.path.length > 1 ? " · " : ""}${message.message}`,
      message.fraction
    );
    changed("jobs");
    return;
  }
  if (message.kind === "failed") {
    appendDiagnostics(active.job, message.diagnostics ?? []);
    finish(id, "failed", message.error);
    return;
  }
  try {
    receiveOutput(id, active, message);
  } catch (error) {
    finish(id, "failed", error instanceof Error ? error.message : String(error));
  }
}
function receiveOutput(
  id: string,
  active: RunningJob,
  message: Exclude<GenerationMessage, { kind: "progress" | "diagnostic" | "failed" }>
) {
  if (message.kind === "preview") {
    active.preview = { grid: message.grid, label: message.label };
    changed("jobs");
    return;
  }
  requireThat(
    session(active.job.worldId).snapshot.world.version === active.expectedVersion,
    "generation_conflict",
    "The world was edited during generation. Your edits were kept. Generate again from the current geography."
  );
  if (message.kind === "snapshot") active.delivery = new GenerationReceiver(message);
  else {
    requireThat(
      active.delivery,
      "generation_delivery",
      "Receive the generation snapshot before its resources."
    );
    if (message.kind === "completed") {
      complete(id, active, active.delivery);
      finish(id, "completed");
      return;
    }
    active.delivery.receive(message);
  }
  if (active.initial) {
    const delivery = active.delivery!;
    active.job.partial = true;
    session(active.job.worldId).snapshot = {
      ...delivery.snapshot,
      world: {
        ...delivery.visibleWorld(active.expectedVersion),
        generations: active.original.world.generations,
      },
    };
    changed();
  }
}
function complete(id: string, active: RunningJob, delivery: GenerationReceiver) {
  const candidate = delivery.complete();
  active.job.partial = false;
  appendDiagnostics(active.job, delivery.diagnostics);
  const entry = session(active.job.worldId);
  const areaId = active.input.areaId;
  entry.causes[areaId] = [...(entry.causes[areaId] ?? []), ...delivery.history];
  if (active.initial) entry.snapshot = active.original;
  publish(active.job.worldId, candidate, "generate", id);
}
function appendDiagnostics(job: GenerationJob, diagnostics: Diagnostic[]) {
  const entries = [...(job.diagnostics ?? []), ...diagnostics];
  job.diagnostics = [...new Map(entries.map((entry) => [JSON.stringify(entry), entry])).values()];
}
function finish(id: string, status: string, error: string | null = null) {
  const active = running.get(id);
  if (!active) return;
  active.worker.terminate();
  running.delete(id);
  const stage = status === "completed" ? "Geography ready" : `${status}: ${active.job.stage}`;
  logProgress(
    active.job,
    error ? `${stage}: ${error}` : stage,
    status === "completed" ? 1 : active.job.progress
  );
  if (error) console.error(`[atlas generation ${id}] ${error}`);
  Object.assign(active.job, {
    status,
    error,
    stage,
    progress: status === "completed" ? 1 : active.job.progress,
  });
  changed("jobs");
}
function logProgress(job: GenerationJob, message: string, progress: number) {
  job.stage = message;
  job.progress = progress;
  console.log(
    `[atlas generation ${job.id}] +${((Date.now() - job.startedAt) / 1000).toFixed(1)}s ${message}`
  );
}
export function cancelGeneration(id: string) {
  finish(id, "cancelled");
}

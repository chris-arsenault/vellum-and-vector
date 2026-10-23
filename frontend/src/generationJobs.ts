import { requireThat, type DomainSnapshot, type World, type Diagnostic } from "@atlas/domain";
import {
  atlasParametersSchema,
  prepareAtlasGeneration,
  publishGenerationProducts,
  type AtlasGenerationInput,
  type CompletedBoundary,
} from "@atlas/generation";
import { session, changed, publish, worldScope } from "./atlasState";

interface GenerationJob {
  id: string;
  worldId: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  startedAt: number;
  diagnostics?: Diagnostic[];
}
interface RunningJob {
  job: GenerationJob;
  worker: Worker;
  expectedVersion: number;
  input: AtlasGenerationInput;
}
const jobs: GenerationJob[] = [];
const running = new Map<string, RunningJob>();
export function listJobs(id: string) {
  return jobs.filter((j) => j.worldId === id).map((j) => ({ ...j }));
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
  running.set(job.id, { job, worker, expectedVersion: input.expectedVersion, input });
  worker.onmessage = (event: MessageEvent<WorkerResult>) => receive(job.id, event.data);
  worker.onerror = (event) => finish(job.id, "failed", event.message);
  worker.onmessageerror = () =>
    finish(job.id, "failed", "Could not read the generation worker's result.");
  worker.postMessage({
    snapshot: { ...snapshot, scope: worldScope(snapshot.world, input.areaId) },
    input,
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
type WorkerResult =
  | { kind: "progress"; path: string[]; fraction: number; message: string }
  | { kind: "completed"; result: CompletedBoundary }
  | { kind: "failed"; error: string; diagnostics?: Diagnostic[] };
function receive(id: string, message: WorkerResult) {
  const active = running.get(id);
  if (!active) return;
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
    active.job.diagnostics = message.diagnostics;
    finish(id, "failed", message.error);
    return;
  }
  try {
    complete(id, active, message.result);
    finish(id, "completed");
  } catch (error) {
    finish(id, "failed", error instanceof Error ? error.message : String(error));
  }
}
function complete(id: string, active: RunningJob, result: CompletedBoundary) {
  logProgress(active.job, "Publishing fields and coverage in the editor", 0.997);
  changed("jobs");
  requireThat(
    session(active.job.worldId).snapshot.world.version === active.expectedVersion,
    "generation_conflict",
    "The world was edited during generation. Your edits were kept. Generate again from the current geography."
  );
  const warnings: Diagnostic[] = [],
    candidate = generationSnapshot(
      result,
      active.input,
      id,
      session(active.job.worldId).snapshot,
      warnings
    );
  for (const warning of warnings) console.warn(`[atlas generation ${id}] ${warning.message}`);
  if (warnings.length) active.job.diagnostics = warnings;
  const entry = session(active.job.worldId);
  const areaId = active.input.areaId;
  entry.causes[areaId] = [
    ...(entry.causes[areaId] ?? []),
    ...result.state.history,
    ...(result.state.causes?.length
      ? [{ path: ["present"], ancestry: [], causes: result.state.causes }]
      : []),
  ];
  publish(active.job.worldId, candidate, "generate", id);
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

export function generationSnapshot(
  result: CompletedBoundary,
  input: AtlasGenerationInput,
  id: string,
  original?: DomainSnapshot,
  warnings: Diagnostic[] = []
): DomainSnapshot {
  const snapshot = result.state.domain,
    world = snapshot.world;
  world.version++;
  publishGenerationProducts(result.state, id, original, warnings);
  const area = world.areas[input.areaId];
  area.version = world.version;
  world.generations.push({
    id,
    areaId: input.areaId,
    domains: input.domains,
    quality: input.quality,
    seed: input.seed,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    completedAt: new Date().toISOString(),
    physicalEpochs: structuredClone(world.epochs),
    magicSystems: structuredClone(world.magicSystems ?? []),
    configuration: input.configuration && { ...input.configuration },
  });
  return snapshot;
}

import {
  semanticId,
  requireThat,
  profiles,
  validateCoverage,
  type DomainSnapshot,
  type FieldRef,
  type Layer,
} from "@atlas/domain";
import type { AtlasGenerationInput, CompletedBoundary } from "@atlas/generation";
import { session, changed, publish, worldScope } from "./atlasState";

interface GenerationJob {
  id: string;
  worldId: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
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
  };
  jobs.unshift(job);
  running.set(job.id, { job, worker, expectedVersion: input.expectedVersion, input });
  worker.onmessage = (event: MessageEvent<WorkerResult>) => receive(job.id, event.data);
  worker.onerror = (event) => finish(job.id, "failed", event.message);
  worker.postMessage({
    snapshot: { ...snapshot, scope: worldScope(snapshot.world, input.areaId) },
    input,
  });
  changed("jobs");
  return { ...job };
}
type WorkerResult =
  | { kind: "progress"; path: string[]; fraction: number; message: string }
  | { kind: "completed"; result: CompletedBoundary }
  | { kind: "failed"; error: string };
function receive(id: string, message: WorkerResult) {
  const active = running.get(id);
  if (!active) return;
  if (message.kind === "progress") {
    active.job.stage = `${message.path.slice(0, -1).join(" / ")}${message.path.length > 1 ? " · " : ""}${message.message}`;
    active.job.progress = message.fraction;
    changed("jobs");
    return;
  }
  if (message.kind === "failed") {
    finish(id, "failed", message.error);
    return;
  }
  try {
    requireThat(
      session(active.job.worldId).snapshot.world.version === active.expectedVersion,
      "generation_conflict",
      "The world was edited during generation. Your edits were kept. Generate again from the current geography."
    );
    const candidate = generationSnapshot(message.result, active.input, id);
    const entry = session(active.job.worldId);
    const areaId = active.input.areaId;
    entry.causes[areaId] = [
      ...(entry.causes[areaId] ?? []),
      ...message.result.state.history,
      ...(message.result.state.causes?.length
        ? [{ path: ["present"], ancestry: [], causes: message.result.state.causes }]
        : []),
    ];
    publish(active.job.worldId, candidate, "generate", id);
    finish(id, "completed");
  } catch (error) {
    finish(id, "failed", error instanceof Error ? error.message : String(error));
  }
}
function finish(id: string, status: string, error: string | null = null) {
  const active = running.get(id);
  if (!active) return;
  active.worker.terminate();
  running.delete(id);
  Object.assign(active.job, {
    status,
    error,
    stage: status === "completed" ? "Geography ready" : status,
    progress: status === "completed" ? 1 : active.job.progress,
  });
  changed("jobs");
}
export function cancelGeneration(id: string) {
  finish(id, "cancelled");
}

export function generationSnapshot(
  result: CompletedBoundary,
  input: AtlasGenerationInput,
  id: string
): DomainSnapshot {
  const snapshot = result.state.domain,
    world = snapshot.world,
    grid = result.state.surface;
  world.version++;
  publishFields(snapshot, grid, id);
  const area = world.areas[input.areaId];
  for (const layer of Object.values(world.layers).filter((l) =>
    input.domains.includes(l.generator ?? "")
  )) {
    const coverage = {
      id: semanticId(world.id, "generated-coverage", `${area.id}:${layer.id}`),
      areaId: area.id,
      spaceId: grid.scope.spaceId,
      layerId: layer.id,
      detailRank: profiles.indexOf(area.profile),
      resolution: grid.scope.resolution ?? null,
      time: "present",
      footprint: grid.scope.footprint,
      state: "generated" as const,
      resourceId: grid.id,
      generationId: id,
    };
    validateCoverage(
      world,
      coverage,
      snapshot.coverage.filter((c) => c.id !== coverage.id)
    );
    snapshot.coverage = [...snapshot.coverage.filter((c) => c.id !== coverage.id), coverage];
    area.layers[layer.id] = "generated";
  }
  area.version = world.version;
  world.generations.push({
    id,
    domains: input.domains,
    quality: input.quality,
    completedAt: new Date().toISOString(),
  });
  return snapshot;
}
function channelLayer(channel: string) {
  if (channel === "elevation") return "elevation";
  if (channel.startsWith("culture:")) return "cultures";
  if (channel.startsWith("magic:") || ["heat", "storedHeat", "coastalPressure"].includes(channel))
    return "magic";
  if (
    [
      "bedrock",
      "sediment",
      "rock",
      "naturalRock",
      "fracture",
      "province",
      "crustMotionX",
      "crustMotionY",
      "uplift",
      "carbonate",
      "erosion",
      "deposition",
      "crustThickness",
      "crustSupport",
      "rockLoad",
      "continentalFraction",
      "crustAge",
      "sutureStrength",
      "suturePair",
      "assembly",
      "tectonicBoundary",
      "boundaryPair",
      "margin",
      "tectonicStrain",
      "volcanicConstruction",
      "impactExcavation",
      "impactRim",
      "impactEjecta",
      "fluvialErosion",
      "glacialErosion",
      "coastalErosion",
      "glacialDeposition",
      "landform",
    ].includes(channel)
  )
    return "geology";
  if (
    [
      "receiver",
      "drainageRank",
      "drainageElevation",
      "flow",
      "runoff",
      "outletFlow",
      "basin",
      "water",
      "waterDepth",
      "depressionDepth",
      "waterBody",
      "oceanDistance",
      "riverOrder",
      "riverChannel",
      "floodplain",
      "delta",
      "oceanCurrent",
      "waveExposure",
    ].includes(channel)
  )
    return "rivers";
  return "climate";
}
function fieldGroups(grid: CompletedBoundary["state"]["surface"]) {
  const groups = new Map<string, string[]>();
  for (const channel of Object.keys(grid.channels)) {
    if (grid.units[channel] === "cell-index") continue;
    const layer = channelLayer(channel);
    groups.set(layer, [...(groups.get(layer) ?? []), channel]);
  }
  return groups;
}
function publishFields(
  snapshot: DomainSnapshot,
  grid: CompletedBoundary["state"]["surface"],
  runId: string
) {
  for (const [layerId, channels] of fieldGroups(grid)) {
    const world = snapshot.world,
      areaId = grid.scope.areaId;
    const fieldId = semanticId(world.id, "atlas-field", `${areaId}:${layerId}`);
    const existing = world.fields.find((field) => field.id === fieldId);
    if (existing?.state === "authored" || existing?.state === "protected") continue;
    const resourceId = semanticId(world.id, "atlas-samples", `${runId}:${layerId}`);
    const field: FieldRef = {
      id: fieldId,
      areaId,
      layerId,
      algorithm: "atlas-2/canonry-0f62584c",
      source: { kind: "run", id: runId },
      samples: grid.active.length,
      channels,
      resourceId,
      state: "generated",
      footprint: grid.scope.footprint,
      spaceId: grid.scope.spaceId,
    };
    world.fields = [...world.fields.filter((f) => f.id !== fieldId), field];
    snapshot.numerical[fieldId] = {
      ...grid,
      id: resourceId,
      channels: Object.fromEntries(channels.map((c) => [c, grid.channels[c]])),
      units: Object.fromEntries(channels.map((c) => [c, grid.units[c]])),
      overlays: snapshot.numerical[fieldId]?.overlays,
    };
    world.layers[layerId].facts = [
      ...new Set([...(world.layers[layerId].facts ?? []), ...channels]),
    ];
    const layer = world.layers[layerId];
    layer.representations = [
      ...new Set<NonNullable<Layer["representations"]>[number]>([
        ...(layer.representations ?? []),
        "field",
      ]),
    ];
  }
}

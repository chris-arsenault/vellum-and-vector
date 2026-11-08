import { requireThat } from "@atlas/domain";
import {
  listSavedMaps,
  readSavedMap,
  registerSavedMap,
  type SavedMapSummary,
} from "@atlas/storage-browser";
import { atlasWorkspace, readEditorWorld, rememberWorld } from "./atlasWorkspace";
import { clearGenerationJobs, listJobs } from "./generationJobs";

export { listSavedMaps, type SavedMapSummary };

/** Snapshot and registration both run while this tab holds the shared storage lease, so
 * another tab's collector cannot run between them. Completion is read from the world. */
export async function saveMap(id: string) {
  const jobs = listJobs(id);
  requireThat(
    !jobs.some((job) => job.status === "running"),
    "incomplete_generation",
    "Finish generation before saving this map."
  );
  requireThat(
    !(await readEditorWorld(id)).publication,
    "incomplete_generation",
    "Finish generation before saving this map."
  );
  const saved = await (await atlasWorkspace()).saveWorld(id);
  await registerSavedMap({
    id,
    name: saved.name,
    version: saved.version,
    savedAt: new Date().toISOString(),
    root: saved.root,
  });
}

export async function openSavedMap(id: string) {
  const saved = await readSavedMap(id);
  requireThat(saved, "missing_saved_map", "This saved map is no longer available.");
  requireThat(saved.format === 3, "saved_map_format", "This saved map uses an unsupported format.");
  clearGenerationJobs(id);
  const workspace = await atlasWorkspace();
  const world = await workspace.openSavedWorld(id, saved.root);
  rememberWorld(world);
  return world;
}

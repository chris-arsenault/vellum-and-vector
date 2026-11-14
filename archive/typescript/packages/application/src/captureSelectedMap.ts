import { effectiveTraits, requireThat, type Area, type CatalogChanges } from "@atlas/domain";
import type { MapRef } from "@atlas/map";
import type { FieldInputStore, SpatialCatalog } from "@atlas/storage-browser";
import { generationSource } from "./workspaceGeneration";
import { captureMap } from "./mapCapture";

export type CompletedInputReader = (
  reference: MapRef,
  read: (
    catalog: SpatialCatalog,
    input: { worldId: string; areaId: string; revision: number }
  ) => Promise<void>
) => Promise<void>;

/** Capture on the generation host, using exactly the revision named by the map selection. */
export async function captureSelectedMap(
  read: CompletedInputReader,
  resources: FieldInputStore,
  reference: MapRef,
  area: Area,
  publication: CatalogChanges
) {
  await read(reference, async (catalog, input) => {
    requireThat(
      input.worldId === publication.worldId && input.areaId === area.map?.sourceAreaId,
      "map_selection_parent",
      "Select a region in the mapped parent being refined."
    );
    const source = await generationSource(catalog, input.worldId, input.areaId);
    // owner-direction(2026-10-29): later parent changes leave children's captured inputs unchanged.
    area.map = { ...area.map!, sourceRevision: input.revision, sourceMap: reference };
    area.traits = effectiveTraits({ ...source.world.areas, [area.id]: area }, area.id);
    const captured: CatalogChanges = {
      ...publication,
      expected: [],
      writes: [],
      resources: [],
      geography: [],
    };
    await captureMap(catalog, resources, source, area, captured);
    publication.writes.push(...captured.writes);
    publication.resources.push(...captured.resources);
    (publication.geography ??= []).push(...(captured.geography ?? []));
    // The source is immutable. Only destination record identities need current-catalog checks.
    const existing = new Set(publication.expected.map((ref) => `${ref.kind}:${ref.id}`));
    for (const { reference: target } of captured.writes)
      if (!existing.has(`${target.kind}:${target.id}`)) {
        publication.expected.push(target);
        existing.add(`${target.kind}:${target.id}`);
      }
  });
}

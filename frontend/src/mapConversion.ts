import { areaDepth, effectiveTraits, type DomainSnapshot, type ChangeSet } from "@atlas/domain";
import { catalogChanges } from "@atlas/application";
import type { BrowserWorkspace } from "@atlas/storage-browser";
import { worldScope } from "./worldCreation";
import { captureMap } from "./mapCapture";

/** Open old saved geography once, preserving its composed detail before detaching ancestry. */
export async function captureExistingMaps(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  worldId: string
) {
  const initial = await current.catalog.readEditor(worldId);
  const pending = Object.values(initial.areas)
    .filter((area) => area.regionId && !area.map)
    .sort((a, b) => areaDepth(initial.areas, b.id) - areaDepth(initial.areas, a.id));
  for (const previous of pending) {
    const world = await current.catalog.readEditor(worldId),
      source: DomainSnapshot = await current.catalog.readAuthoring({
        scope: worldScope(world, previous.id),
        objects: [],
        spatialLayers: Object.keys(world.layers),
        channels: [],
        parentHistory: [],
        dependencies: false,
        constraints: { intersectingAreas: true, descendantsOf: [], boundaryFeatures: [] },
      }),
      area = {
        ...source.world.areas[previous.id],
        map: { sourceAreaId: previous.parentId!, sourceRevision: world.version },
        boundary: null,
      },
      changes: ChangeSet = {
        operationId: crypto.randomUUID(),
        expectedVersion: world.version,
        worldId,
        actor: "user",
        readSet: source.revisions,
        writes: [{ kind: "area", value: area }],
        removes: [],
        invalidations: [],
        highImpact: false,
      },
      publication = catalogChanges(source, changes, [], "captureMap");
    area.traits = effectiveTraits({ ...world.areas, [area.id]: area }, area.id);
    try {
      await captureMap(current.catalog, current.resources, source, area, publication);
      await current.catalog.commit(publication);
    } catch (error) {
      for (const resource of [...publication.resources].reverse())
        await current.resources.remove(resource.id);
      throw error;
    }
  }
  return current.catalog.readEditor(worldId);
}

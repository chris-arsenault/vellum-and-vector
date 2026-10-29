import { openBrowserWorkspace, registerSavedMap } from "@atlas/storage-browser";
import { areaSpace, rectangle, type CatalogRecord, type DomainWrite } from "@atlas/domain";
import type { GenerationFixtureOptions } from "./generationFixture";
import type { MapArchive } from "./mapArchive";
import { openSpatialRuntime } from "../src/spatialRuntime";

export interface MapCustomization {
  summary: MapArchive["summary"];
  name: string;
  fixture: GenerationFixtureOptions;
}

/** Customize the scenario's copied catalog without repeating generation or resource publication. */
self.onmessage = async ({ data }: MessageEvent<MapCustomization>) => {
  const closeSpatial = await openSpatialRuntime();
  let reply: { id: string } | { error: string };
  try {
    const workspace = await openBrowserWorkspace(data.summary.root.name);
    try {
      const world = await workspace.catalog.readEditor(data.summary.id);
      const root = Object.values(world.areas).find((area) => !area.parentId)!;
      const scope = { worldId: world.id, areaId: root.id, spaceId: areaSpace(world, root.id) };
      const record = (write: DomainWrite): CatalogRecord => ({
        scope,
        reference: { kind: write.kind, id: write.value.id, revision: 0 },
        data: write,
      });
      const writes: CatalogRecord[] = [
        record({ kind: "area", value: { ...root, name: data.name } }),
      ];
      const [storedRoot] = await workspace.catalog.readRecords(scope, "area", [root.id]);
      writes[0].reference = storedRoot.reference;
      if (data.fixture.mappedRegion) {
        const supplied = data.fixture.mappedRegion;
        const area = {
          ...root,
          id: crypto.randomUUID(),
          name: supplied.name,
          parentId: root.id,
          profile: "region" as const,
          footprint: rectangle(supplied.extent),
        };
        writes.push(record({ kind: "area", value: area }));
        for (const feature of supplied.features)
          writes.push({
            ...record({ kind: "feature", value: { ...feature, areaId: area.id } }),
            scope: { ...scope, areaId: area.id },
          });
      }
      for (const feature of data.fixture.features ?? [])
        writes.push(record({ kind: "feature", value: { ...feature, areaId: root.id } }));
      for (const landmark of data.fixture.landmarks ?? [])
        writes.push(
          record({
            kind: "landmark",
            value: { ...landmark, areaId: root.id, spaceId: scope.spaceId },
          })
        );
      if (data.fixture.society)
        writes.push(
          record({
            kind: "society",
            value: { ...data.fixture.society, id: `society:${root.id}`, areaId: root.id },
          })
        );
      await workspace.catalog.commit({
        operationId: crypto.randomUUID(),
        worldId: world.id,
        expected: writes.map((write) => write.reference),
        writes,
        removes: [],
        resources: [],
        metadata: { name: data.name },
      });
      const current = await workspace.catalog.readWorld(world.id);
      await registerSavedMap({ ...data.summary, name: data.name, version: current.version });
      reply = { id: world.id };
    } finally {
      await workspace.close();
    }
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error) };
  } finally {
    closeSpatial();
  }
  self.postMessage(reply);
};

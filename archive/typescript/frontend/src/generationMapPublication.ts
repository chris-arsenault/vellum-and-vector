import type { DomainSnapshot, FeatureReader } from "@atlas/domain";
import type { MapAssets } from "@atlas/storage-browser/maps";
import type { WorkspaceClient } from "./WorkspaceClient";
import type { WorkspaceFields } from "@atlas/application";
import { mapSnapshotChannels } from "./mapSnapshotRasters";
import { mapSnapshotProduct } from "./mapSnapshotProduct";
import { publishMapProduct } from "./mapProductPublication";

/** The temporary TS producer publishes through the same map boundary as the Rust producer. */
export async function publishGeneratedMap(
  workspace: WorkspaceClient,
  fields: WorkspaceFields,
  assets: Pick<MapAssets, "raster" | "vectors" | "illustration">,
  snapshot: DomainSnapshot,
  features: FeatureReader,
  revision: number,
  signal: AbortSignal
) {
  const { world, scope } = snapshot;
  const area = world.areas[scope.areaId];
  const expected = await workspace.maps.head(world.id, area.id);
  const parent = area.map
    ? (area.map.sourceMap ??
      (await workspace.maps.parent(world.id, area.map.sourceAreaId, area.map.sourceRevision)))
    : null;
  const selected = new Set(
    [...mapSnapshotChannels(snapshot, area.id).values()].map((field) => field.id)
  );
  await fields.read(snapshot, {
    scope,
    objects: [],
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
    channels: world.fields
      .filter((field) => selected.has(field.id))
      .map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
  });
  const history = await workspace.readCauses(world.id, area.id);
  const reference = { mapId: area.id, revision: crypto.randomUUID() };
  return publishMapProduct(
    { publication: workspace.maps.publisher(world.id, revision), assets },
    mapSnapshotProduct(snapshot, { reference, expected, parent }, features, history),
    signal
  );
}

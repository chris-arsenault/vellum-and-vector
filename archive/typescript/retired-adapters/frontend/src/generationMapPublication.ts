import type { DomainSnapshot, FeatureReader } from "@atlas/domain";
import type { BinaryStore, GeometryKernel } from "@atlas/storage-browser";
import { publishFinishedMap, type MapAssets } from "@atlas/storage-browser/maps";
import type { WorkspaceClient } from "./WorkspaceClient";

interface Host {
  workspace: WorkspaceClient;
  binary: BinaryStore;
  kernel: GeometryKernel;
  mapAssets: Pick<MapAssets, "producerFiles">;
}
/** The browser facade supplies local handles; Rust assembles and publishes the entire map. */
export async function publishGeneratedMap(
  host: Host,
  snapshot: DomainSnapshot,
  features: FeatureReader,
  revision: number,
  signal: AbortSignal
) {
  const { world, scope } = snapshot,
    area = world.areas[scope.areaId],
    workspace = host.workspace,
    expected = await workspace.maps.head(world.id, area.id),
    parent = area.map
      ? (area.map.sourceMap ??
        (await workspace.maps.parent(world.id, area.map.sourceAreaId, area.map.sourceRevision)))
      : null;
  return publishFinishedMap(
    JSON.stringify({
      world,
      areaId: area.id,
      reference: { mapId: area.id, revision: crypto.randomUUID() },
      expected,
      parent,
      history: await workspace.readCauses(world.id, area.id),
      fieldPatches: snapshot.fieldPatches,
    }),
    {
      publication: workspace.maps.publisher(world.id, revision),
      assets: host.mapAssets,
      binary: host.binary,
      kernel: host.kernel,
      precision: world.reference.precision ?? 1e-6,
      features,
      geography: (scope, id) => workspace.readFieldGeography(scope, id),
    },
    signal
  );
}

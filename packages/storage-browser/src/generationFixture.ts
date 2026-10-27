import sqliteInit from "@sqlite.org/sqlite-wasm";
import { configureSpatial, type DomainSnapshot } from "@atlas/domain";
import { GeometryKernel } from "./geometryKernel";
import { GeosSpatial } from "./geosSpatial";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { SqliteNetworkWorkspace } from "./networkWorkspace";
import { SqliteContourWorkspace } from "./contourWorkspace";
import { arenaFixture } from "./numericalFixture";
import { numericalPageSamples, numericalWorkingCacheBytes } from "./pagedArena";

/** Shared generation uses SQLite WASM in memory, GEOS and a host-file numerical arena. */
export async function generationStorageFixture() {
  const sqlite = await sqliteInit();
  const db = new sqlite.oo1.DB(":memory:");
  const kernel = await GeometryKernel.create();
  const working = arenaFixture(numericalWorkingCacheBytes, numericalPageSamples);
  configureSpatial((precision) => new GeosSpatial(kernel, precision));
  const options = {
    numerical: working.arena,
    features: new SqliteFeatureWorkspace(db),
    sourceFeatures: new SqliteFeatureWorkspace(db, "source_features"),
    networks: new SqliteNetworkWorkspace(db),
    sourceNetworks: new SqliteNetworkWorkspace(db, "source_networks"),
    contours: new SqliteContourWorkspace(db),
  };
  return {
    options,
    source(snapshot: DomainSnapshot) {
      for (const feature of Object.values(snapshot.world.features))
        options.sourceFeatures.put(feature);
      for (const node of Object.values(snapshot.world.networkNodes ?? {}))
        options.sourceNetworks.putNode(node);
      for (const reach of Object.values(snapshot.world.networkReaches ?? {}))
        options.sourceNetworks.putReach(reach);
    },
    close() {
      configureSpatial();
      working.close();
      db.close();
      kernel.close();
    },
  };
}

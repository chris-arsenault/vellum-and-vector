import sqliteInit from "@sqlite.org/sqlite-wasm";
import { configureSpatial, type DomainSnapshot } from "@atlas/domain";
import { GeometryKernel } from "./geometryKernel";
import { GeosSpatial } from "./geosSpatial";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { SqliteNetworkWorkspace } from "./networkWorkspace";
import { SqliteContourWorkspace } from "./contourWorkspace";
import { blockCacheFixture } from "./blockCacheFixture";

/** The world's resident block budget in bytes; `ATLAS_BLOCK_BUDGET` forces eviction. */
export function blockBudgetBytes() {
  const budget = Number(process.env.ATLAS_BLOCK_BUDGET);
  return Number.isFinite(budget) && budget > 0 ? budget : Infinity;
}
/** Shared generation uses SQLite WASM in memory, GEOS and a host-file block cache for every
 * coverage: the physical world, the surface grid and society. */
export async function generationStorageFixture() {
  const sqlite = await sqliteInit();
  const db = new sqlite.oo1.DB(":memory:");
  const kernel = await GeometryKernel.create();
  const blocks = blockCacheFixture(blockBudgetBytes());
  configureSpatial((precision) => new GeosSpatial(kernel, precision));
  const options = {
    cache: blocks.cache,
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
      blocks.close();
      db.close();
      kernel.close();
    },
  };
}
